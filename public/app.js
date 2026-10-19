"use strict";

const fmt1 = new Intl.NumberFormat("es-CR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const fmt0 = new Intl.NumberFormat("es-CR", { maximumFractionDigits: 0 });

const ESCALA = { min: 20, max: 60 };
const VENTANA_MS = 3 * 60 * 1000;

const $ = (id) => document.getElementById(id);

const els = {
  reloj: $("reloj"),
  fuente: $("fuente"),
  fuenteTexto: $("fuente-texto"),
  temperatura: $("temperatura"),
  fase: $("fase"),
  detalle: $("detalle"),
  hechoConsigna: $("hecho-consigna"),
  hechoMv: $("hecho-mv"),
  hechoRele: $("hecho-rele"),
  thermoFill: $("thermo-fill"),
  thermoBanda: $("thermo-banda"),
  thermoSet: $("thermo-set"),
  thermoLimite: $("thermo-limite"),
  bombilla: $("bombilla"),
  tarjetaFoco: $("tarjeta-foco"),
  rele: $("rele"),
  releTexto: $("rele-texto"),
  modoAuto: $("modo-auto"),
  modoManual: $("modo-manual"),
  poder: $("poder"),
  ayudaFoco: $("ayuda-foco"),
  consigna: $("consigna"),
  consignaValor: $("consigna-valor"),
  histeresis: $("histeresis"),
  histeresisValor: $("histeresis-valor"),
  histeresisBanda: $("histeresis-banda"),
  limite: $("limite"),
  limiteValor: $("limite-valor"),
  ambiente: $("ambiente"),
  ambienteValor: $("ambiente-valor"),
  tapa: $("tapa"),
  tapaTexto: $("tapa-texto"),
  panelSim: $("panel-sim"),
  usarSim: $("usar-sim"),
  sensorMv: $("sensor-mv"),
  sensorAdc: $("sensor-adc"),
  sensorPaso: $("sensor-paso"),
  statMin: $("stat-min"),
  statAvg: $("stat-avg"),
  statMax: $("stat-max"),
  grafica: $("grafica"),
  registro: $("registro"),
  bannerCorte: $("banner-corte"),
  bannerSensor: $("banner-sensor"),
  redLocal: $("red-local"),
  aviso: $("aviso"),
};

const TEXTOS = {
  calentando: "Calentando",
  en_rango: "En rango",
  enfriando: "Enfriando",
  manual_on: "Manual · foco encendido",
  manual_off: "Manual · foco apagado",
  corte: "Corte de seguridad",
  sin_sensor: "Sin lectura del sensor",
};

let estado = null;
let historial = [];
let eventos = [];
let socketAbierta = false;
let huboSocket = false;
let registroFirma = "";
let avisoTimer = 0;
let ajusteTimer = 0;
let ajustePendiente = false;
let registrarSiguiente = false;

function grado(valor) {
  return `${fmt1.format(valor)} °C`;
}

function mostrarAviso(texto) {
  els.aviso.hidden = false;
  els.aviso.textContent = texto;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => {
    els.aviso.hidden = true;
  }, 4200);
}

async function post(ruta, cuerpo) {
  const respuesta = await fetch(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    mostrarAviso(datos.error || "No se pudo aplicar el cambio.");
    throw new Error(datos.error || "error");
  }
  return datos;
}

function valorConsigna() {
  if (ajustePendiente || document.activeElement === els.consigna) return Number(els.consigna.value);
  return estado ? estado.consigna : Number(els.consigna.value);
}

function pintarConsigna(valor) {
  els.consignaValor.textContent = grado(valor);
  if (!ajustePendiente && document.activeElement !== els.consigna) els.consigna.value = String(valor);
}

function pintarTermometro(temp, consigna, histeresis, limite) {
  const alto = (valor) => {
    const porcentaje = ((valor - ESCALA.min) / (ESCALA.max - ESCALA.min)) * 100;
    return Math.min(100, Math.max(0, porcentaje));
  };
  const base = alto(consigna - histeresis / 2);
  const techo = alto(consigna + histeresis / 2);
  els.thermoFill.style.height = `${alto(temp)}%`;
  els.thermoSet.style.bottom = `${alto(consigna)}%`;
  els.thermoLimite.style.bottom = `${alto(limite)}%`;
  els.thermoBanda.style.bottom = `${base}%`;
  els.thermoBanda.style.height = `${Math.max(0, techo - base)}%`;
}

function detalleDe(datos, consignaVisible) {
  if (datos.fase === "corte") return "El relé está abierto hasta que se reponga el corte.";
  if (datos.fase === "sin_sensor") return "Sin datos del LM35 el foco no se enciende.";
  if (datos.tapaAbierta && datos.equilibrio + 0.3 < consignaVisible) {
    return `Con la tapa abierta el foco estabiliza la caja cerca de ${grado(datos.equilibrio)}.`;
  }
  if (datos.modo === "auto") return "El relé sigue la consigna dentro de la banda de histéresis.";
  return "El foco queda como lo dejes, siempre debajo del límite de seguridad.";
}

function pintar(datos) {
  if (!datos) return;
  estado = datos;
  const consignaVisible = valorConsigna();
  const histeresisVisible = ajustePendiente || document.activeElement === els.histeresis
    ? Number(els.histeresis.value)
    : datos.histeresis;
  const limiteVisible = ajustePendiente || document.activeElement === els.limite
    ? Number(els.limite.value)
    : datos.limiteSeguridad;

  els.temperatura.textContent = fmt1.format(datos.temperatura);
  els.fase.textContent = TEXTOS[datos.fase] || datos.fase;
  els.fase.dataset.fase = datos.fase;
  els.detalle.textContent = detalleDe(datos, consignaVisible);
  els.hechoConsigna.textContent = grado(datos.consigna);
  els.hechoMv.textContent = `${fmt0.format(datos.lm35_mV)} mV`;
  els.hechoRele.textContent = datos.foco ? "Cerrado" : "Abierto";

  pintarTermometro(datos.temperatura, consignaVisible, histeresisVisible, limiteVisible);
  pintarConsigna(consignaVisible);
  if (!ajustePendiente && document.activeElement !== els.histeresis) els.histeresis.value = String(datos.histeresis);
  if (!ajustePendiente && document.activeElement !== els.limite) els.limite.value = String(datos.limiteSeguridad);
  if (!ajustePendiente && document.activeElement !== els.ambiente) els.ambiente.value = String(datos.ambiente);

  els.histeresisValor.textContent = `${fmt1.format(histeresisVisible)} °C`;
  const bajo = consignaVisible - histeresisVisible / 2;
  const alto = consignaVisible + histeresisVisible / 2;
  els.histeresisBanda.textContent = `Enciende a ${grado(bajo)} y apaga a ${grado(alto)}.`;
  els.limiteValor.textContent = `${fmt0.format(limiteVisible)} °C`;
  els.ambienteValor.textContent = `${fmt0.format(document.activeElement === els.ambiente ? els.ambiente.value : datos.ambiente)} °C`;

  els.bombilla.classList.toggle("is-on", datos.foco);
  els.tarjetaFoco.classList.toggle("is-on", datos.foco);
  els.rele.classList.toggle("is-closed", datos.foco);
  els.releTexto.textContent = datos.foco ? "Relé cerrado" : "Relé abierto";

  els.modoAuto.setAttribute("aria-pressed", String(datos.modo === "auto"));
  els.modoManual.setAttribute("aria-pressed", String(datos.modo === "manual"));
  els.poder.textContent = datos.corteSeguridad
    ? "Foco bloqueado"
    : datos.foco
      ? "Apagar foco"
      : "Encender foco";
  els.poder.dataset.accion = datos.foco ? "apagar" : "encender";
  els.poder.classList.toggle("is-on", datos.foco);
  els.poder.disabled = datos.corteSeguridad;
  els.ayudaFoco.textContent = datos.corteSeguridad
    ? "Hay que reponer el corte antes de volver a encender el foco."
    : datos.modo === "auto"
      ? "Un toque apaga o enciende el foco y deja el control en manual."
      : "El automático vuelve a cuidar la consigna por su cuenta.";

  els.tapa.setAttribute("aria-pressed", String(datos.tapaAbierta));
  els.tapaTexto.textContent = datos.tapaAbierta ? "Abierta" : "Cerrada";
  document.querySelectorAll("[data-ritmo]").forEach((boton) => {
    boton.setAttribute("aria-pressed", String(Number(boton.dataset.ritmo) === datos.ritmo));
  });

  const simulando = datos.fuente === "simulacion";
  els.panelSim.hidden = !simulando;
  els.usarSim.hidden = simulando;

  els.sensorMv.textContent = `${fmt0.format(datos.lm35_mV)} mV`;
  els.sensorAdc.textContent = `cuenta ${fmt0.format(datos.cuentasAdc)}`;
  els.sensorPaso.textContent = grado(datos.pasoAdc);

  els.bannerCorte.hidden = !datos.corteSeguridad;
  els.bannerSensor.hidden = datos.sensorVivo || datos.corteSeguridad;

  if (huboSocket && !socketAbierta) {
    els.fuente.className = "pill is-bad";
    els.fuenteTexto.textContent = "Reconectando";
  } else if (!simulando && !datos.sensorVivo) {
    els.fuente.className = "pill is-bad";
    els.fuenteTexto.textContent = "Sin sensor";
  } else if (!simulando) {
    els.fuente.className = "pill is-live";
    els.fuenteTexto.textContent = "LM35 en vivo";
  } else {
    els.fuente.className = "pill";
    els.fuenteTexto.textContent = "Simulación";
  }

  pintarRegistro();
  pintarEstadisticas();
  dibujar();
}

function pintarRegistro() {
  const firma = eventos.map((evento) => `${evento.t}:${evento.texto}`).join("|");
  if (firma === registroFirma) return;
  registroFirma = firma;
  els.registro.replaceChildren();
  for (const evento of eventos.slice(0, 8)) {
    const item = document.createElement("li");
    const hora = document.createElement("time");
    hora.dateTime = new Date(evento.t).toISOString();
    hora.textContent = new Date(evento.t).toLocaleTimeString("es-CR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    item.append(hora, document.createTextNode(evento.texto));
    els.registro.append(item);
  }
}

function muestrasVisibles() {
  const desde = Date.now() - VENTANA_MS;
  return historial.filter((muestra) => muestra.t >= desde);
}

function pintarEstadisticas() {
  const muestras = muestrasVisibles();
  if (!muestras.length) {
    els.statMin.textContent = "—";
    els.statAvg.textContent = "—";
    els.statMax.textContent = "—";
    return;
  }
  let min = Infinity;
  let max = -Infinity;
  let suma = 0;
  for (const muestra of muestras) {
    min = Math.min(min, muestra.temperatura);
    max = Math.max(max, muestra.temperatura);
    suma += muestra.temperatura;
  }
  els.statMin.textContent = grado(min);
  els.statMax.textContent = grado(max);
  els.statAvg.textContent = grado(suma / muestras.length);
}

function incorporar(mensaje) {
  if (mensaje.tipo === "inicio" || mensaje.historial) {
    historial = mensaje.historial || [];
    eventos = mensaje.eventos || [];
  } else if (mensaje.muestra) {
    historial.push(mensaje.muestra);
    const corte = Date.now() - (VENTANA_MS + 60000);
    while (historial.length && historial[0].t < corte) historial.shift();
  }
  if (mensaje.eventosNuevos) {
    for (const evento of mensaje.eventosNuevos) eventos.unshift(evento);
    if (eventos.length > 40) eventos.length = 40;
  }
  pintar(mensaje);
}

function dibujar() {
  const canvas = els.grafica;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ancho = Math.max(rect.width, 280);
  const alto = Math.max(rect.height, 180);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(ancho * dpr);
  canvas.height = Math.round(alto * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, ancho, alto);

  const pad = { l: 44, r: 12, t: 16, b: 28 };
  const plotW = ancho - pad.l - pad.r;
  const plotH = alto - pad.t - pad.b;
  const ahora = Date.now();
  const x0 = ahora - VENTANA_MS;
  const puntos = muestrasVisibles();
  const consigna = estado ? estado.consigna : 37.5;
  const limite = estado ? estado.limiteSeguridad : 47;
  const valores = puntos.map((punto) => punto.temperatura);
  let yMin = Math.min(22, consigna - 3, ...valores);
  let yMax = Math.max(48, consigna + 3, limite, ...valores);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 20;
    yMax = 50;
  }
  const margen = (yMax - yMin) * 0.12 || 1;
  yMin -= margen;
  yMax += margen;

  const xDe = (t) => pad.l + ((t - x0) / VENTANA_MS) * plotW;
  const yDe = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  ctx.font = "12px IBM Plex Mono, Segoe UI, monospace";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(236, 220, 196, 0.12)";
  ctx.fillStyle = "#746b60";
  const paso = yMax - yMin > 20 ? 5 : 2;
  const inicio = Math.ceil(yMin / paso) * paso;
  for (let marca = inicio; marca < yMax; marca += paso) {
    const y = yDe(marca);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(ancho - pad.r, y);
    ctx.stroke();
    ctx.fillText(String(marca), 4, y + 4);
  }

  for (let minutos = 3; minutos >= 0; minutos -= 1) {
    const t = ahora - minutos * 60000;
    const x = xDe(t);
    ctx.fillStyle = "#746b60";
    ctx.fillText(minutos === 0 ? "ahora" : `-${minutos} min`, x - (minutos === 0 ? 28 : 18), alto - 8);
  }

  if (estado) {
    const yBajo = yDe(consigna - estado.histeresis / 2);
    const yAlto = yDe(consigna + estado.histeresis / 2);
    ctx.fillStyle = "rgba(240, 162, 2, 0.10)";
    ctx.fillRect(pad.l, yAlto, plotW, yBajo - yAlto);
    ctx.save();
    ctx.strokeStyle = "#e15d4c";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, yDe(limite));
    ctx.lineTo(ancho - pad.r, yDe(limite));
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.l, pad.t, plotW, plotH);
  ctx.clip();
  ctx.lineWidth = 2;
  for (let i = 1; i < puntos.length; i += 1) {
    ctx.beginPath();
    ctx.strokeStyle = puntos[i].foco ? "#f0a202" : "#f6f1e7";
    ctx.moveTo(xDe(puntos[i - 1].t), yDe(puntos[i - 1].temperatura));
    ctx.lineTo(xDe(puntos[i].t), yDe(puntos[i].temperatura));
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#c4844a";
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad.l, yDe(consigna));
  ctx.lineTo(ancho - pad.r, yDe(consigna));
  ctx.stroke();
  ctx.restore();

  if (puntos.length) {
    const ultimo = puntos[puntos.length - 1];
    ctx.beginPath();
    ctx.fillStyle = ultimo.foco ? "#f0a202" : "#f6f1e7";
    ctx.arc(xDe(ultimo.t), yDe(ultimo.temperatura), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function ajustesActuales(registrar) {
  return {
    consigna: Number(els.consigna.value),
    histeresis: Number(els.histeresis.value),
    limiteSeguridad: Number(els.limite.value),
    ambiente: Number(els.ambiente.value),
    ritmo: estado ? estado.ritmo : 2,
    tapaAbierta: estado ? estado.tapaAbierta : false,
    registrar,
  };
}

function enviarAjustes(extra = {}, registrar = false) {
  clearTimeout(ajusteTimer);
  ajustePendiente = true;
  const cuerpo = { ...ajustesActuales(registrar), ...extra };
  if (cuerpo.limiteSeguridad < cuerpo.consigna + 2) {
    registrarSiguiente = false;
    mostrarAviso("El límite tiene que quedar al menos 2 °C sobre la consigna.");
    if (estado) {
      els.consigna.value = String(estado.consigna);
      els.limite.value = String(estado.limiteSeguridad);
      els.histeresis.value = String(estado.histeresis);
      ajustePendiente = false;
      pintar(estado);
    } else {
      ajustePendiente = false;
    }
    return Promise.resolve();
  }
  registrarSiguiente = false;
  return post("/api/ajustes", cuerpo)
    .then((datos) => {
      ajustePendiente = false;
      pintar(datos);
    })
    .catch((error) => {
      ajustePendiente = false;
      throw error;
    });
}

function programarAjuste() {
  clearTimeout(ajusteTimer);
  ajustePendiente = true;
  ajusteTimer = setTimeout(() => {
    const registrar = registrarSiguiente;
    enviarAjustes({}, registrar).catch(() => {});
  }, 140);
}

function alMover(input) {
  input.addEventListener("input", () => {
    if (estado) pintar({ ...estado });
    programarAjuste();
  });
  input.addEventListener("change", () => {
    registrarSiguiente = true;
    programarAjuste();
  });
}

function moverConsigna(delta) {
  const siguiente = Math.min(45, Math.max(28, Math.round((Number(els.consigna.value) + delta) * 10) / 10));
  els.consigna.value = String(siguiente);
  registrarSiguiente = true;
  if (estado) pintar({ ...estado, consigna: siguiente });
  programarAjuste();
}

els.consignaMenos = $("consigna-menos");
els.consignaMas = $("consigna-mas");
els.reponer = $("reponer");
els.volverSimBanner = $("volver-sim");

els.consignaMenos.addEventListener("click", () => moverConsigna(-0.1));
els.consignaMas.addEventListener("click", () => moverConsigna(0.1));
alMover(els.consigna);
alMover(els.histeresis);
alMover(els.limite);
alMover(els.ambiente);

els.modoAuto.addEventListener("click", () => {
  post("/api/modo", { modo: "auto" }).then(pintar).catch(() => {});
});
els.modoManual.addEventListener("click", () => {
  post("/api/modo", { modo: "manual" }).then(pintar).catch(() => {});
});
let focoOcupado = false;
els.poder.addEventListener("click", () => {
  if (!estado || estado.corteSeguridad || focoOcupado) return;
  focoOcupado = true;
  const encendido = els.poder.dataset.accion === "encender";
  post("/api/foco", { encendido })
    .then(pintar)
    .catch(() => {})
    .finally(() => {
      focoOcupado = false;
    });
});
els.tapa.addEventListener("click", () => {
  if (!estado) return;
  enviarAjustes({ tapaAbierta: !estado.tapaAbierta }, false).catch(() => {});
});
document.querySelectorAll("[data-ritmo]").forEach((boton) => {
  boton.addEventListener("click", () => {
    enviarAjustes({ ritmo: Number(boton.dataset.ritmo) }, true).catch(() => {});
  });
});

function volverSimulacion() {
  post("/api/fuente", { fuente: "simulacion" }).then(pintar).catch(() => {});
}
els.usarSim.addEventListener("click", volverSimulacion);
els.volverSimBanner.addEventListener("click", volverSimulacion);
els.reponer.addEventListener("click", () => {
  post("/api/reponer", {}).then(pintar).catch(() => {});
});

function pintarReloj() {
  els.reloj.textContent = new Date().toLocaleTimeString("es-CR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  els.reloj.dateTime = new Date().toISOString();
}

function conectar() {
  const protocolo = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocolo}://${location.host}/ws`);
  socket.addEventListener("open", () => {
    socketAbierta = true;
    huboSocket = true;
    if (estado) pintar(estado);
  });
  socket.addEventListener("message", (evento) => {
    incorporar(JSON.parse(evento.data));
  });
  socket.addEventListener("close", () => {
    socketAbierta = false;
    if (estado) pintar(estado);
    setTimeout(conectar, 1500);
  });
}

fetch("/api/estado")
  .then((respuesta) => respuesta.json())
  .then((datos) => {
    if (datos.red && datos.red.length) {
      els.redLocal.textContent = `Desde la PCB, apunta el microcontrolador a ${datos.red[0]}.`;
    } else {
      els.redLocal.textContent = "Con la laptop y la PCB en la misma red, usa la IP de esta computadora y el puerto del panel.";
    }
    if (!estado) incorporar({ tipo: "inicio", ...datos });
  })
  .catch(() => mostrarAviso("No se pudo abrir el panel."));

conectar();
pintarReloj();
setInterval(pintarReloj, 1000);
window.addEventListener("resize", dibujar);
