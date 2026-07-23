const moduleNode = document.getElementById("fees-module");
const bodyNode = document.getElementById("fees-table-body");
const feedbackNode = document.getElementById("fees-feedback");
const dialog = document.getElementById("fee-dialog");
const form = document.getElementById("fee-form");
const newBtn = document.getElementById("new-fee-btn");
const cancelBtn = document.getElementById("cancel-fee-btn");

const idInput = document.getElementById("fee-id");
const nameInput = document.getElementById("fee-name");
const actionInput = document.getElementById("fee-action");
const priceIdInput = document.getElementById("fee-price-id");
const titleEl = document.getElementById("fee-dialog-title");
const hintEl = document.getElementById("fee-dialog-hint");

const recurringRangeFields = document.getElementById("recurring-range-fields");
const occasionalPriceFields = document.getElementById("occasional-price-fields");

const rangeFromInput = document.getElementById("fee-range-from");
const rangeToInput = document.getElementById("fee-range-to");
const monthlyPygInput = document.getElementById("fee-monthly-pyg");
const monthlyUsdInput = document.getElementById("fee-monthly-usd");
const yearlyPygInput = document.getElementById("fee-yearly-pyg");
const yearlyUsdInput = document.getElementById("fee-yearly-usd");

if (!moduleNode || !bodyNode) {
  throw new Error("No se encontró el módulo de tarifas.");
}

const mode = moduleNode.dataset.feeMode || "recurrentes";
const canManage = (moduleNode.dataset.canManage || "false") === "true";
const basePath = mode === "unicas" ? "/api/tarifas/unicas" : "/api/tarifas/recurrentes";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function setFeedback(message, isError = false) {
  if (!feedbackNode) return;
  feedbackNode.textContent = message;
  feedbackNode.classList.toggle("error", isError);
}

function setDialogHint(message) {
  if (!hintEl) return;
  hintEl.textContent = message || "";
}

function getServiceId(item) {
  return item?.servicio?.servicio_id ?? item?.service_id ?? item?.id ?? "";
}

function getServiceName(item) {
  return item?.servicio?.nombre ?? item?.name ?? "";
}

function getRecurringPrices(item) {
  const ranges = item?.precios_recurrentes ?? item?.recurring_prices ?? item?.prices_recurrentes ?? [];
  return Array.isArray(ranges) ? ranges : [];
}

function getOccasionalPrice(item) {
  return item?.precio_ocasional ?? item?.occasional_price ?? null;
}

function getPriceId(price, fallback) {
  return price?.price_id ?? price?.id ?? price?._id ?? String(fallback);
}

function resetDialog() {
  form.reset();
  actionInput.value = "";
  priceIdInput.value = "";
  idInput.readOnly = false;
  nameInput.readOnly = false;
  idInput.required = true;
  nameInput.required = true;
  setDialogHint("");
}

function setPriceInputs(price) {
  monthlyPygInput.value = price?.precio_mensual_pyg ?? "";
  monthlyUsdInput.value = price?.precio_mensual_usd ?? "";
  yearlyPygInput.value = price?.precio_anual_pyg ?? "";
  yearlyUsdInput.value = price?.precio_anual_usd ?? "";
}

function setRangeInputs(price) {
  rangeFromInput.value = price?.rango_desde ?? "";
  rangeToInput.value = price?.rango_hasta ?? "";
  setPriceInputs(price);
}

function setDialogMode(action, context = {}) {
  resetDialog();
  actionInput.value = action;

  const serviceId = context.serviceId || "";
  const serviceName = context.serviceName || "";
  const price = context.price || null;

  idInput.value = serviceId;
  nameInput.value = serviceName;
  priceIdInput.value = context.priceId || "";

  const showRecurring = mode === "recurrentes" && ["create-service", "add-range", "edit-range"].includes(action);
  const showOccasional = mode === "unicas" && ["create-service", "create-price", "edit-price"].includes(action);

  if (recurringRangeFields) recurringRangeFields.hidden = !showRecurring;
  if (occasionalPriceFields) occasionalPriceFields.hidden = !showOccasional;

  if (mode === "recurrentes") {
    if (action === "create-service") {
      titleEl.textContent = "Nuevo servicio recurrente";
      setDialogHint("Debes cargar al menos un rango de precio.");
      setRangeInputs(null);
    }
    if (action === "edit-service") {
      titleEl.textContent = "Editar servicio";
      idInput.readOnly = true;
      setDialogHint("Solo se edita el nombre del servicio.");
    }
    if (action === "add-range") {
      titleEl.textContent = "Agregar rango recurrente";
      idInput.readOnly = true;
      nameInput.readOnly = true;
      setRangeInputs(null);
    }
    if (action === "edit-range") {
      titleEl.textContent = "Editar rango recurrente";
      idInput.readOnly = true;
      nameInput.readOnly = true;
      setRangeInputs(price);
    }
  }

  if (mode === "unicas") {
    if (action === "create-service") {
      titleEl.textContent = "Nuevo servicio ocasional";
      setDialogHint("Puedes crear el servicio con precio ocasional fijo.");
      setPriceInputs(null);
    }
    if (action === "edit-service") {
      titleEl.textContent = "Editar servicio";
      idInput.readOnly = true;
      setDialogHint("Solo se edita el nombre del servicio.");
    }
    if (action === "create-price") {
      titleEl.textContent = "Crear precio ocasional";
      idInput.readOnly = true;
      nameInput.readOnly = true;
      setPriceInputs(null);
    }
    if (action === "edit-price") {
      titleEl.textContent = "Editar precio ocasional";
      idInput.readOnly = true;
      nameInput.readOnly = true;
      setPriceInputs(price);
    }
  }

  if (dialog.showModal) dialog.showModal();
}

function openNew() {
  setDialogMode("create-service");
}

function buildRangePayload() {
  return {
    rango_desde: toNumber(rangeFromInput.value),
    rango_hasta: toNumber(rangeToInput.value),
    precio_mensual_pyg: toNumber(monthlyPygInput.value),
    precio_mensual_usd: toNumber(monthlyUsdInput.value),
    precio_anual_pyg: toNumber(yearlyPygInput.value),
    precio_anual_usd: toNumber(yearlyUsdInput.value),
  };
}

function buildOccasionalPayload() {
  return {
    precio_mensual_pyg: toNumber(monthlyPygInput.value),
    precio_mensual_usd: toNumber(monthlyUsdInput.value),
    precio_anual_pyg: toNumber(yearlyPygInput.value),
    precio_anual_usd: toNumber(yearlyUsdInput.value),
  };
}

function normalizeItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.resultados)) return data.resultados;
  return [];
}

function renderRecurringRows(items) {
  bodyNode.innerHTML = (items || [])
    .map((item) => {
      const serviceId = getServiceId(item);
      const serviceName = getServiceName(item);
      //const serviceName = "Cualquier servicio";
      const ranges = getRecurringPrices(item);

      console.debug("Nombre del servicio", item);

      const rangesHtml = ranges.length
        ? ranges
            .map((range, index) => {
              const priceId = getPriceId(range, index);
              const summary = `${range.rango_desde ?? "-"} a ${range.rango_hasta ?? "-"} | M: ${range.precio_mensual_usd ?? 0} USD (${range.precio_mensual_pyg ?? 0} PYG) | A: ${range.precio_anual_usd ?? 0} USD (${range.precio_anual_pyg ?? 0} PYG)`;
              const actions = canManage
                ? `<button class="secondary-btn fee-action" data-action="edit-range" data-id="${escapeHtml(serviceId)}" data-name="${escapeHtml(serviceName)}" data-price-id="${escapeHtml(priceId)}" data-range-index="${index}">Editar rango</button>
                   <button class="danger-btn fee-action" data-action="delete-range" data-id="${escapeHtml(serviceId)}" data-price-id="${escapeHtml(priceId)}">Eliminar rango</button>`
                : "";
              return `<li>${escapeHtml(summary)} ${actions}</li>`;
            })
            .join("")
        : "<span>-</span>";

      const serviceActions = canManage
        ? `<button class="secondary-btn fee-action" data-action="edit-service" data-id="${escapeHtml(serviceId)}" data-name="${escapeHtml(serviceName)}">Editar</button>
           <button class="secondary-btn fee-action" data-action="add-range" data-id="${escapeHtml(serviceId)}" data-name="${escapeHtml(serviceName)}">Agregar rango</button>
           <button class="danger-btn fee-action" data-action="delete-service" data-id="${escapeHtml(serviceId)}">Eliminar</button>`
        : "-";

      return `
        <tr data-service='${escapeHtml(JSON.stringify(item))}'>
          <td>${escapeHtml(serviceId) || "-"}</td>
          <td>${escapeHtml(serviceName) || "-"}</td>
          <td><ul>${rangesHtml}</ul></td>
          <td class="actions-col">${serviceActions}</td>
        </tr>
      `;
    })
    .join("");
}

function formatOccasionalPrice(price) {
  if (!price) return "Sin precio";
  return `M: ${price.precio_mensual_usd ?? 0} USD (${price.precio_mensual_pyg ?? 0} PYG) | A: ${price.precio_anual_usd ?? 0} USD (${price.precio_anual_pyg ?? 0} PYG)`;
}

function renderOccasionalRows(items) {
  bodyNode.innerHTML = (items || [])
    .map((item) => {
      const serviceId = getServiceId(item);
      const serviceName = getServiceName(item);
      const price = getOccasionalPrice(item);

      const priceActions = !canManage
        ? "-"
        : price
          ? `<button class="secondary-btn fee-action" data-action="edit-price" data-id="${escapeHtml(serviceId)}" data-name="${escapeHtml(serviceName)}">Editar precio</button>
             <button class="danger-btn fee-action" data-action="delete-price" data-id="${escapeHtml(serviceId)}">Eliminar precio</button>`
          : `<button class="secondary-btn fee-action" data-action="create-price" data-id="${escapeHtml(serviceId)}" data-name="${escapeHtml(serviceName)}">Crear precio</button>`;

      const serviceActions = canManage
        ? `<button class="secondary-btn fee-action" data-action="edit-service" data-id="${escapeHtml(serviceId)}" data-name="${escapeHtml(serviceName)}">Editar</button>
           <button class="danger-btn fee-action" data-action="delete-service" data-id="${escapeHtml(serviceId)}">Eliminar</button>`
        : "";

      return `
        <tr>
          <td>${escapeHtml(serviceId) || "-"}</td>
          <td>${escapeHtml(serviceName) || "-"}</td>
          <td>${escapeHtml(formatOccasionalPrice(price))}</td>
          <td class="actions-col">${priceActions} ${serviceActions}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadItems() {
  setFeedback("");
  try {
    const response = await fetch(`${basePath}?pagina=1&tamano_pagina=50`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "No se pudo cargar servicios");
    }
    const data = await response.json();
    const items = normalizeItems(data);

    if (mode === "recurrentes") {
      renderRecurringRows(items);
    } else {
      renderOccasionalRows(items);
    }
  } catch (error) {
    setFeedback(error.message, true);
  }
}

async function callApi(path, method, payload = null) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Operación fallida");
  }

  return response.json().catch(() => ({}));
}

async function saveItem(event) {
  event.preventDefault();

  const action = actionInput.value;
  const serviceId = idInput.value.trim();
  const serviceName = nameInput.value.trim();
  const priceId = priceIdInput.value.trim();

  try {
    if (mode === "recurrentes") {
      if (action === "create-service") {
        await callApi(basePath, "POST", {
          servicio_id: serviceId,
          nombre: serviceName,
          precios_recurrentes: [buildRangePayload()],
        });
      }
      if (action === "edit-service") {
        await callApi(`${basePath}/${encodeURIComponent(serviceId)}`, "PUT", { nombre: serviceName });
      }
      if (action === "add-range") {
        await callApi(`${basePath}/${encodeURIComponent(serviceId)}/rangos`, "POST", buildRangePayload());
      }
      if (action === "edit-range") {
        await callApi(
          `${basePath}/${encodeURIComponent(serviceId)}/rangos/${encodeURIComponent(priceId)}`,
          "PUT",
          buildRangePayload(),
        );
      }
    }

    if (mode === "unicas") {
      if (action === "create-service") {
        await callApi(basePath, "POST", {
          servicio_id: serviceId,
          nombre: serviceName,
          precio_ocasional: buildOccasionalPayload(),
        });
      }
      if (action === "edit-service") {
        await callApi(`${basePath}/${encodeURIComponent(serviceId)}`, "PUT", { nombre: serviceName });
      }
      if (action === "create-price") {
        await callApi(`${basePath}/${encodeURIComponent(serviceId)}/precio`, "POST", buildOccasionalPayload());
      }
      if (action === "edit-price") {
        await callApi(`${basePath}/${encodeURIComponent(serviceId)}/precio`, "PUT", buildOccasionalPayload());
      }
    }

    dialog.close();
    setFeedback("Cambios guardados correctamente");
    await loadItems();
  } catch (error) {
    setFeedback(error.message, true);
  }
}

async function handleTableAction(event) {
  const button = event.target.closest(".fee-action");
  if (!button) return;

  const action = button.dataset.action;
  const serviceId = button.dataset.id || "";
  const serviceName = button.dataset.name || "";

  try {
    if (action === "edit-service") {
      setDialogMode("edit-service", { serviceId, serviceName });
      return;
    }

    if (action === "add-range") {
      setDialogMode("add-range", { serviceId, serviceName });
      return;
    }

    if (action === "edit-range") {
      const row = button.closest("tr");
      const rawService = row?.dataset?.service;
      const service = rawService ? JSON.parse(rawService) : {};
      const ranges = getRecurringPrices(service);
      const index = Number(button.dataset.rangeIndex || 0);
      const price = ranges[index] || null;
      setDialogMode("edit-range", {
        serviceId,
        serviceName,
        price,
        priceId: button.dataset.priceId || "",
      });
      return;
    }

    if (action === "create-price") {
      setDialogMode("create-price", { serviceId, serviceName });
      return;
    }

    if (action === "edit-price") {
      const row = button.closest("tr");
      const response = await fetch(`${basePath}?pagina=1&tamano_pagina=50`);
      if (!response.ok) {
        throw new Error("No se pudo cargar el precio del servicio");
      }
      const data = await response.json().catch(() => ({}));
      const item = normalizeItems(data).find((entry) => String(getServiceId(entry)) === String(serviceId));
      setDialogMode("edit-price", {
        serviceId,
        serviceName,
        price: getOccasionalPrice(item),
      });
      return;
    }

    if (action === "delete-service") {
      if (!confirm("¿Eliminar servicio?")) return;
      await callApi(`${basePath}/${encodeURIComponent(serviceId)}`, "DELETE");
      setFeedback("Servicio eliminado");
      await loadItems();
      return;
    }

    if (action === "delete-range") {
      if (!confirm("¿Eliminar rango de precio?")) return;
      const priceId = button.dataset.priceId || "";
      await callApi(`${basePath}/${encodeURIComponent(serviceId)}/rangos/${encodeURIComponent(priceId)}`, "DELETE");
      setFeedback("Rango eliminado");
      await loadItems();
      return;
    }

    if (action === "delete-price") {
      if (!confirm("¿Eliminar precio ocasional?")) return;
      await callApi(`${basePath}/${encodeURIComponent(serviceId)}/precio`, "DELETE");
      setFeedback("Precio eliminado");
      await loadItems();
    }
  } catch (error) {
    setFeedback(error.message, true);
  }
}

if (newBtn && canManage) {
  newBtn.addEventListener("click", openNew);
}
if (cancelBtn) {
  cancelBtn.addEventListener("click", () => dialog.close());
}
if (form && canManage) {
  form.addEventListener("submit", saveItem);
}
bodyNode.addEventListener("click", handleTableAction);

loadItems();