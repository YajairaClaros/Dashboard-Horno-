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
  delta: $("delta"),
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
  puntero: $("puntero"),
  punteroTemp: $("puntero-temp"),
  punteroHora: $("puntero-hora"),
  punteroFoco: $("puntero-foco"),
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
let filtroEventos = "todos";
let cursor = null;
let marco = null;
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
  const diferencia = datos.temperatura - consignaVisible;
  const enBanda = Math.abs(diferencia) <= histeresisVisible / 2;
  const lectura = els.temperatura.parentElement;
  lectura.classList.toggle("is-ok", enBanda);
  lectura.classList.toggle("is-hot", !enBanda && diferencia > 0);
  lectura.classList.toggle("is-cool", !enBanda && diferencia <= 0);
  els.delta.textContent = enBanda
    ? "Dentro de la banda de la consigna"
    : diferencia > 0
      ? `${fmt1.format(diferencia)} °C por encima de la consigna`
      : `${fmt1.format(Math.abs(diferencia))} °C por debajo de la consigna`;
  els.delta.dataset.lado = enBanda ? "ok" : diferencia > 0 ? "arriba" : "abajo";
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

function horaCorta(fecha, conSegundos) {
  return fecha.toLocaleTimeString("es-CR", {
    hour: "2-digit",
    minute: "2-digit",
    second: conSegundos ? "2-digit" : undefined,
    hourCycle: "h23",
  });
}

function eventoVisible(evento) {
  if (filtroEventos === "todos") return true;
  if (filtroEventos === "foco") return evento.tipo === "foco" || evento.tipo === "modo";
  if (filtroEventos === "consigna") return ["consigna", "histeresis", "limite"].includes(evento.tipo);
  if (filtroEventos === "corte") return evento.tipo === "corte" || evento.tipo === "sensor";
  return true;
}

function pintarRegistro() {
  const visibles = eventos.filter(eventoVisible).slice(0, 12);
  const firma = `${filtroEventos}|${visibles.map((evento) => `${evento.t}:${evento.texto}`).join("|")}`;
  if (firma === registroFirma) return;
  registroFirma = firma;
  els.registro.replaceChildren();
  if (!visibles.length) {
    const vacio = document.createElement("li");
    vacio.className = "log-vacio";
    vacio.textContent = eventos.length
      ? "No hay eventos de este tipo."
      : "Todavía no hay eventos.";
    els.registro.append(vacio);
    return;
  }
  for (const evento of visibles) {
    const item = document.createElement("li");
    item.tabIndex = 0;
    const hora = document.createElement("time");
    const marca = new Date(evento.t);
    hora.dateTime = marca.toISOString();
    hora.textContent = horaCorta(marca, true);
    const punto = document.createElement("span");
    punto.className = `log-dot dot-${evento.tipo || "nota"}`;
    const texto = document.createElement("span");
    texto.textContent = evento.texto;
    item.append(hora, punto, texto);
    const abrir = () => enfocarEvento(evento, item);
    item.addEventListener("click", abrir);
    item.addEventListener("keydown", (tecla) => {
      if (tecla.key === "Enter" || tecla.key === " ") {
        tecla.preventDefault();
        abrir();
      }
    });
    els.registro.append(item);
  }
}

function muestraCercana(instante) {
  const puntos = muestrasVisibles();
  let mejor = null;
  let distancia = Infinity;
  for (const punto of puntos) {
    const delta = Math.abs(punto.t - instante);
    if (delta < distancia) {
      distancia = delta;
      mejor = punto;
    }
  }
  return distancia <= 20000 ? mejor : null;
}

function enfocarEvento(evento, item) {
  for (const fila of els.registro.children) fila.classList.remove("is-selected");
  item.classList.add("is-selected");
  const punto = muestraCercana(evento.t);
  if (!punto) {
    mostrarAviso("Ese momento ya salió de los últimos 3 minutos.");
    return;
  }
  cursor = punto;
  dibujar();
  document.querySelector(".chart-card").scrollIntoView({ behavior: "smooth", block: "center" });
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

  const colores = getComputedStyle(document.documentElement);
  const colorTemp = colores.getPropertyValue("--temp").trim() || "#3ddec8";
  const colorAmber = colores.getPropertyValue("--amber").trim() || "#ffb020";
  const colorPeligro = colores.getPropertyValue("--danger").trim() || "#ff6b5a";
  const colorEje = colores.getPropertyValue("--faint").trim() || "#7f9099";

  const pad = { l: 46, r: 16, t: 16, b: 28 };
  const plotW = ancho - pad.l - pad.r;
  const plotH = alto - pad.t - pad.b;
  const ahora = Date.now();
  const x0 = ahora - VENTANA_MS;
  const puntos = muestrasVisibles();
  const consigna = estado ? estado.consigna : 37.5;
  const histeresis = estado ? estado.histeresis : 1;
  const limite = estado ? estado.limiteSeguridad : 47;
  const valores = puntos.map((punto) => punto.temperatura);
  const referencia = valores.length ? valores : [consigna];
  let yMin = Math.min(consigna - histeresis / 2, ...referencia);
  let yMax = Math.max(consigna + histeresis / 2, ...referencia);
  if (limite <= yMax + 6) yMax = Math.max(yMax, limite);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = consigna - 4;
    yMax = consigna + 4;
  }
  const centro = (yMin + yMax) / 2;
  const span = Math.max(8, yMax - yMin);
  yMin = centro - span / 2 - 0.8;
  yMax = centro + span / 2 + 0.8;

  const xDe = (t) => pad.l + ((t - x0) / VENTANA_MS) * plotW;
  const yDe = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const dentro = (v) => v >= yMin && v <= yMax;
  marco = { pad, plotW, plotH, x0, ancho, xDe, yDe };

  ctx.font = "12px IBM Plex Mono, Segoe UI, monospace";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(28, 48, 64, 0.12)";
  ctx.fillStyle = colorEje;
  const paso = span <= 10 ? 1 : span <= 18 ? 2 : 5;
  for (let marca = Math.ceil(yMin / paso) * paso; marca < yMax; marca += paso) {
    const y = yDe(marca);
    if (y < pad.t || y > pad.t + plotH) continue;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(ancho - pad.r, y);
    ctx.stroke();
    ctx.fillText(String(marca), 8, y + 4);
  }

  if (estado && dentro(consigna)) {
    const yBajo = yDe(consigna - histeresis / 2);
    const yAlto = yDe(consigna + histeresis / 2);
    ctx.fillStyle = "rgba(217, 132, 8, 0.12)";
    ctx.fillRect(pad.l, Math.min(yAlto, yBajo), plotW, Math.abs(yBajo - yAlto));
  }

  const cinta = 8;
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.l, pad.t, plotW, plotH);
  ctx.clip();
  ctx.fillStyle = "rgba(28, 48, 64, 0.08)";
  ctx.fillRect(pad.l, pad.t + plotH - cinta, plotW, cinta);
  ctx.fillStyle = colorAmber;
  let tramo = null;
  for (let i = 0; i < puntos.length; i += 1) {
    if (puntos[i].foco && tramo == null) tramo = puntos[i].t;
    const termina = !puntos[i].foco || i === puntos.length - 1;
    if (tramo != null && termina) {
      const anchoTramo = Math.max(3, xDe(puntos[i].t) - xDe(tramo));
      ctx.fillRect(xDe(tramo), pad.t + plotH - cinta, anchoTramo, cinta);
      tramo = null;
    }
  }

  if (puntos.length > 1) {
    const gradiente = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    gradiente.addColorStop(0, "rgba(12, 143, 132, 0.22)");
    gradiente.addColorStop(1, "rgba(12, 143, 132, 0.02)");
    ctx.beginPath();
    ctx.moveTo(xDe(puntos[0].t), yDe(puntos[0].temperatura));
    for (let i = 1; i < puntos.length; i += 1) {
      ctx.lineTo(xDe(puntos[i].t), yDe(puntos[i].temperatura));
    }
    ctx.lineTo(xDe(puntos[puntos.length - 1].t), pad.t + plotH - cinta);
    ctx.lineTo(xDe(puntos[0].t), pad.t + plotH - cinta);
    ctx.closePath();
    ctx.fillStyle = gradiente;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(xDe(puntos[0].t), yDe(puntos[0].temperatura));
    for (let i = 1; i < puntos.length; i += 1) {
      ctx.lineTo(xDe(puntos[i].t), yDe(puntos[i].temperatura));
    }
    ctx.strokeStyle = colorTemp;
    ctx.lineWidth = 2.8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();

  if (dentro(consigna)) {
    ctx.save();
    ctx.strokeStyle = colorAmber;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, yDe(consigna));
    ctx.lineTo(ancho - pad.r, yDe(consigna));
    ctx.stroke();
    ctx.restore();
  }

  if (dentro(limite)) {
    const yLimite = yDe(limite);
    ctx.save();
    ctx.strokeStyle = colorPeligro;
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(pad.l, yLimite);
    ctx.lineTo(ancho - pad.r, yLimite);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = colorPeligro;
    ctx.font = "11px IBM Plex Mono, Segoe UI, sans-serif";
    ctx.fillText("límite", ancho - pad.r - 42, yLimite - 6);
  }

  ctx.fillStyle = colorEje;
  ctx.font = "12px IBM Plex Mono, Segoe UI, monospace";
  const marcas = ancho < 520 ? [0, 1.5, 3] : [0, 1, 2, 3];
  for (const minutos of marcas) {
    const t = x0 + minutos * 60000;
    const texto = minutos === 3 ? "ahora" : horaCorta(new Date(t), false);
    const medida = ctx.measureText(texto).width;
    let x = xDe(t) - medida / 2;
    if (minutos === 0) x = pad.l;
    if (minutos === 3) x = ancho - pad.r - medida;
    ctx.fillText(texto, x, alto - 8);
  }

  if (puntos.length) {
    const ultimo = puntos[puntos.length - 1];
    const x = xDe(ultimo.t);
    const y = yDe(ultimo.temperatura);
    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorTemp;
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = colorTemp;
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (cursor && (cursor.t < x0 || cursor.t > ahora)) cursor = null;
  if (!cursor) {
    els.puntero.hidden = true;
    return;
  }
  const xCursor = xDe(cursor.t);
  const yCursor = yDe(cursor.temperatura);
  ctx.save();
  ctx.strokeStyle = "rgba(28, 48, 64, 0.45)";
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(xCursor, pad.t);
  ctx.lineTo(xCursor, pad.t + plotH - cinta);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.fillStyle = "#ffffff";
  ctx.arc(xCursor, yCursor, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = colorTemp;
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = colorTemp;
  ctx.arc(xCursor, yCursor, 3.4, 0, Math.PI * 2);
  ctx.fill();
  colocarPuntero(cursor, xCursor, yCursor);
}

function colocarPuntero(punto, x, y) {
  els.puntero.hidden = false;
  els.punteroTemp.textContent = grado(punto.temperatura);
  els.punteroHora.textContent = horaCorta(new Date(punto.t), true);
  els.punteroFoco.textContent = punto.foco ? "Foco encendido" : "Foco apagado";
  const anchoTip = 150;
  let izquierda = x + 14;
  if (izquierda + anchoTip > marco.ancho - 8) izquierda = Math.max(8, x - anchoTip - 10);
  els.puntero.style.left = `${izquierda}px`;
  els.puntero.style.top = `${Math.max(8, y - 36)}px`;
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

els.grafica.addEventListener("pointermove", (evento) => {
  if (!marco) return;
  const rect = els.grafica.getBoundingClientRect();
  const x = evento.clientX - rect.left;
  if (x < marco.pad.l || x > marco.pad.l + marco.plotW) return;
  const instante = marco.x0 + ((x - marco.pad.l) / marco.plotW) * VENTANA_MS;
  const punto = muestraCercana(instante);
  if (!punto || cursor === punto) return;
  cursor = punto;
  dibujar();
});

els.grafica.addEventListener("pointerleave", () => {
  if (!cursor) return;
  cursor = null;
  dibujar();
});

document.querySelectorAll("[data-filtro]").forEach((boton) => {
  boton.addEventListener("click", () => {
    filtroEventos = boton.dataset.filtro;
    document.querySelectorAll("[data-filtro]").forEach((otro) => {
      otro.setAttribute("aria-pressed", String(otro === boton));
    });
    registroFirma = "";
    pintarRegistro();
  });
});

conectar();
pintarReloj();
setInterval(pintarReloj, 1000);
window.addEventListener("resize", dibujar);
