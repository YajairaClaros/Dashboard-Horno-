"use strict";

/**
 * Panel de la incubadora.
 *
 * El navegador se conecta aquí. Cuando la PCB esté lista, el
 * microcontrolador con Wi-Fi hace esto cerca de una vez por segundo:
 *
 *   POST /api/telemetria   { "temperatura": 36.8 }
 *   y obedece la respuesta { "foco": true } o { "foco": false }
 *
 * "foco" es la orden real del relé. Si este servidor no contesta,
 * el microcontrolador debe abrir el relé.
 */

const http = require("http");
const os = require("os");
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const RETENCION_MS = 4 * 60 * 1000;
const ESPERA_SENSOR_MS = 4000;

const estado = {
  temperatura: 26,
  consigna: 37.5,
  histeresis: 1,
  modo: "auto",
  focoManual: false,
  ordenFoco: false,
  foco: false,
  corteSeguridad: false,
  limiteSeguridad: 47,
  tapaAbierta: false,
  ambiente: 24,
  ritmo: 2,
  fuente: "simulacion",
  ultimaTelemetria: 0,
  sensorAvisado: false,
};

const historial = [];
const eventos = [];
let pendientes = [];
let ultimaMuestra = null;
let ultimoInstante = Date.now();

function redondear(valor, decimales) {
  const factor = 10 ** decimales;
  return Math.round((valor + Number.EPSILON) * factor) / factor;
}

function numero(valor, min, max) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function textoNumero(valor, decimales) {
  return valor.toFixed(decimales).replace(".", ",");
}

function anotar(texto, tipo) {
  const evento = { t: Date.now(), texto, tipo: tipo || "nota" };
  eventos.unshift(evento);
  if (eventos.length > 40) eventos.pop();
  pendientes.push(evento);
  return evento;
}

function equilibrioConFoco() {
  return estado.ambiente + (estado.tapaAbierta ? 7 : 26);
}

function sensorVivo() {
  if (estado.fuente === "simulacion") return true;
  return Date.now() - estado.ultimaTelemetria <= ESPERA_SENSOR_MS;
}

function fase() {
  if (estado.corteSeguridad) return "corte";
  if (estado.fuente === "hardware" && !sensorVivo()) return "sin_sensor";
  if (estado.modo === "manual") return estado.foco ? "manual_on" : "manual_off";
  if (estado.foco) return "calentando";
  if (estado.temperatura > estado.consigna + estado.histeresis / 2) return "enfriando";
  return "en_rango";
}

function integrar(dt) {
  const destino = estado.foco ? equilibrioConFoco() : estado.ambiente;
  const tau = estado.tapaAbierta ? 45 : 170;
  estado.temperatura += ((destino - estado.temperatura) / tau) * dt;
  estado.temperatura = Math.min(120, Math.max(-5, estado.temperatura));
}

function aplicarControl() {
  const bajo = estado.consigna - estado.histeresis / 2;
  const alto = estado.consigna + estado.histeresis / 2;

  if (estado.temperatura >= estado.limiteSeguridad && !estado.corteSeguridad) {
    estado.corteSeguridad = true;
    estado.focoManual = false;
    anotar("Corte de seguridad: el foco se apagó al llegar al límite.", "corte");
  }

  if (!sensorVivo()) {
    if (!estado.sensorAvisado) {
      estado.sensorAvisado = true;
      anotar("Sin lecturas del LM35. El foco queda apagado.", "sensor");
    }
    estado.ordenFoco = false;
    estado.foco = false;
    return;
  }

  estado.sensorAvisado = false;

  if (estado.modo === "manual") {
    estado.ordenFoco = estado.focoManual;
  } else if (estado.temperatura <= bajo) {
    estado.ordenFoco = true;
  } else if (estado.temperatura >= alto) {
    estado.ordenFoco = false;
  }

  estado.foco = estado.corteSeguridad ? false : estado.ordenFoco;
}

function registrarMuestra(ahora) {
  ultimaMuestra = {
    t: ahora,
    temperatura: redondear(estado.temperatura, 2),
    consigna: estado.consigna,
    foco: estado.foco,
  };
  historial.push(ultimaMuestra);
  const corte = ahora - RETENCION_MS;
  while (historial.length && historial[0].t < corte) historial.shift();
}

function vistaPublica() {
  const temperatura = redondear(estado.temperatura, 2);
  const mostrada = redondear(temperatura, 1);
  const volts = mostrada * 0.01;
  return {
    temperatura,
    lm35_mV: redondear(mostrada * 10, 0),
    cuentasAdc: Math.round(volts / (5 / 1023)),
    pasoAdc: redondear(5 / 1023 / 0.01, 2),
    consigna: estado.consigna,
    histeresis: estado.histeresis,
    modo: estado.modo,
    foco: estado.foco,
    ordenFoco: estado.ordenFoco,
    corteSeguridad: estado.corteSeguridad,
    limiteSeguridad: estado.limiteSeguridad,
    tapaAbierta: estado.tapaAbierta,
    ambiente: estado.ambiente,
    ritmo: estado.ritmo,
    fuente: estado.fuente,
    sensorVivo: sensorVivo(),
    equilibrio: redondear(equilibrioConFoco(), 1),
    fase: fase(),
    actualizado: Date.now(),
  };
}

function esRedLocal(ip) {
  if (ip.startsWith("192.168.") || ip.startsWith("10.")) return true;
  const partes = ip.split(".").map(Number);
  return partes[0] === 172 && partes[1] >= 16 && partes[1] <= 31;
}

function direccionesLocales() {
  const encontradas = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const red of lista || []) {
      if (red.family === "IPv4" && !red.internal) encontradas.push(red.address);
    }
  }
  return encontradas.sort((a, b) => Number(esRedLocal(b)) - Number(esRedLocal(a)));
}

const app = express();
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/api/estado", (req, res) => {
  res.json({
    ...vistaPublica(),
    historial,
    eventos,
    red: direccionesLocales().map((ip) => `http://${ip}:${PORT}`),
  });
});

app.get("/api/comando", (req, res) => {
  res.json({
    foco: estado.foco,
    consigna: estado.consigna,
    modo: estado.modo,
    corteSeguridad: estado.corteSeguridad,
    histeresis: estado.histeresis,
  });
});

app.post("/api/telemetria", (req, res) => {
  const cuerpo = req.body || {};
  let temperatura = null;
  if (cuerpo.temperatura != null) temperatura = numero(cuerpo.temperatura, -10, 150);
  else if (cuerpo.lm35_mV != null) {
    const mV = numero(cuerpo.lm35_mV, 0, 1500);
    if (mV != null) temperatura = mV / 10;
  } else if (cuerpo.lm35_V != null) {
    const volts = numero(cuerpo.lm35_V, 0, 1.5);
    if (volts != null) temperatura = volts / 0.01;
  }

  if (temperatura == null) {
    res.status(400).json({
      error: "Envía la temperatura en °C, o la salida del LM35 en lm35_mV o lm35_V.",
    });
    return;
  }

  const eraSimulacion = estado.fuente !== "hardware";
  estado.fuente = "hardware";
  estado.ultimaTelemetria = Date.now();
  estado.temperatura = temperatura;
  if (eraSimulacion) anotar("Llegó la primera lectura del LM35.", "sensor");
  aplicarControl();
  res.json({
    foco: estado.foco,
    consigna: estado.consigna,
    modo: estado.modo,
    corteSeguridad: estado.corteSeguridad,
    histeresis: estado.histeresis,
  });
});

app.post("/api/foco", (req, res) => {
  if (typeof req.body?.encendido !== "boolean") {
    res.status(400).json({ error: "Indica encendido: true o false." });
    return;
  }
  if (estado.corteSeguridad && req.body.encendido) {
    res.status(409).json({ error: "El corte de seguridad mantiene el foco apagado." });
    return;
  }

  const veniaAutomatico = estado.modo !== "manual";
  estado.modo = "manual";
  estado.focoManual = req.body.encendido;
  aplicarControl();
  if (veniaAutomatico) anotar("El foco pasó a control manual.", "modo");
  anotar(estado.focoManual ? "Foco encendido desde el panel." : "Foco apagado desde el panel.", "foco");
  res.json(vistaPublica());
});

app.post("/api/modo", (req, res) => {
  const modo = req.body?.modo;
  if (modo !== "auto" && modo !== "manual") {
    res.status(400).json({ error: "El modo tiene que ser auto o manual." });
    return;
  }
  if (modo === "manual") estado.focoManual = estado.foco;
  if (modo !== estado.modo) {
    estado.modo = modo;
    anotar(modo === "auto" ? "Control automático activado." : "Control manual activado.", "modo");
  } else {
    estado.modo = modo;
  }
  aplicarControl();
  res.json(vistaPublica());
});

app.post("/api/ajustes", (req, res) => {
  const cuerpo = req.body || {};
  const consigna = numero(cuerpo.consigna, 28, 45);
  const histeresis = numero(cuerpo.histeresis, 0.4, 3);
  const limiteSeguridad = numero(cuerpo.limiteSeguridad, 35, 70);
  const ambiente = numero(cuerpo.ambiente, 15, 35);
  const ritmo = numero(cuerpo.ritmo, 1, 4);

  if (
    consigna == null ||
    histeresis == null ||
    limiteSeguridad == null ||
    ambiente == null ||
    ritmo == null ||
    ![1, 2, 4].includes(ritmo)
  ) {
    res.status(400).json({ error: "Hay un ajuste fuera de rango." });
    return;
  }
  if (limiteSeguridad < consigna + 2) {
    res.status(400).json({
      error: "El límite de seguridad tiene que quedar al menos 2 °C sobre la consigna.",
    });
    return;
  }

  const registrar = Boolean(cuerpo.registrar);
  if (registrar && consigna !== estado.consigna) {
    anotar(`Consigna en ${textoNumero(consigna, 1)} °C.`, "consigna");
  }
  if (registrar && histeresis !== estado.histeresis) {
    anotar(`Banda de histéresis en ${textoNumero(histeresis, 1)} °C.`, "histeresis");
  }
  if (registrar && limiteSeguridad !== estado.limiteSeguridad) {
    anotar(`Límite de seguridad en ${textoNumero(limiteSeguridad, 0)} °C.`, "limite");
  }
  if (registrar && ambiente !== estado.ambiente) {
    anotar(`Ambiente de simulación en ${textoNumero(ambiente, 0)} °C.`, "ambiente");
  }
  if (registrar && ritmo !== estado.ritmo) {
    anotar(`Ritmo de simulación en ${ritmo}×.`, "ritmo");
  }
  if (typeof cuerpo.tapaAbierta === "boolean" && cuerpo.tapaAbierta !== estado.tapaAbierta) {
    estado.tapaAbierta = cuerpo.tapaAbierta;
    anotar(estado.tapaAbierta ? "Tapa de la caja abierta." : "Tapa de la caja cerrada.", "tapa");
  }

  estado.consigna = redondear(consigna, 1);
  estado.histeresis = redondear(histeresis, 1);
  estado.limiteSeguridad = redondear(limiteSeguridad, 1);
  estado.ambiente = redondear(ambiente, 1);
  estado.ritmo = ritmo;
  aplicarControl();
  res.json(vistaPublica());
});

app.post("/api/reponer", (req, res) => {
  if (!estado.corteSeguridad) {
    res.json(vistaPublica());
    return;
  }
  if (estado.temperatura >= estado.limiteSeguridad) {
    res.status(409).json({ error: "La caja sigue en el límite o por encima. Espera a que baje." });
    return;
  }
  estado.corteSeguridad = false;
  estado.focoManual = false;
  anotar("Corte de seguridad repuesto. El foco sigue apagado hasta una orden nueva.", "corte");
  aplicarControl();
  res.json(vistaPublica());
});

app.post("/api/fuente", (req, res) => {
  if (req.body?.fuente !== "simulacion") {
    res.status(400).json({ error: "Solo se puede pedir volver a simulacion." });
    return;
  }
  if (estado.fuente !== "simulacion") {
    estado.fuente = "simulacion";
    estado.sensorAvisado = false;
    anotar("Se volvió al modelo de la caja.", "fuente");
  }
  aplicarControl();
  res.json(vistaPublica());
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "El cuerpo de la petición no es JSON válido." });
    return;
  }
  next(error);
});

app.use(express.static(path.join(__dirname, "public")));

const servidor = http.createServer(app);
const wss = new WebSocketServer({ server: servidor, path: "/ws" });

function emitir(mensaje) {
  const datos = JSON.stringify(mensaje);
  for (const cliente of wss.clients) {
    if (cliente.readyState === 1) cliente.send(datos);
  }
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({
    tipo: "inicio",
    ...vistaPublica(),
    historial,
    eventos,
  }));
});

function tick() {
  const ahora = Date.now();
  let dt = (ahora - ultimoInstante) / 1000;
  ultimoInstante = ahora;
  if (dt < 0) dt = 0;
  if (dt > 1) dt = 1;

  if (estado.fuente === "simulacion") integrar(dt * estado.ritmo);
  aplicarControl();
  registrarMuestra(ahora);

  const eventosNuevos = pendientes.splice(0, pendientes.length);
  emitir({
    tipo: "muestra",
    ...vistaPublica(),
    muestra: ultimaMuestra,
    eventosNuevos,
  });
}

aplicarControl();
anotar("Panel listo. El control automático tomó la caja.", "inicio");
registrarMuestra(Date.now());
pendientes = [];

setInterval(tick, 250);

servidor.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`El puerto ${PORT} ya está en uso. Cierra el otro panel o define PORT.`);
    process.exit(1);
  }
  throw error;
});

servidor.listen(PORT, "0.0.0.0", () => {
  console.log(`Incubadora lista en http://localhost:${PORT}`);
  for (const ip of direccionesLocales()) {
    console.log(`En la red local: http://${ip}:${PORT}`);
  }
});
