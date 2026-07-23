const form = document.getElementById("prospect-form");
const departamentoEl = document.getElementById("departamento");
const outsourcingSection = document.getElementById("outsourcing-section");
const auditoriaSection = document.getElementById("auditoria-section");
const markdownPreview = document.getElementById("markdown-preview");
const totalOutput = document.getElementById("total-output");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("proyectos-comparables");
const fileCounter = document.getElementById("file-counter");
const avgFeeEl = document.getElementById("avg-fee");
const avgHoursEl = document.getElementById("avg-hours");
const implicitRateLineEl = document.getElementById("implicit-rate-line");
const implicitRateEl = document.getElementById("implicit-rate");
const facturacionAnualNoteEl = document.getElementById("facturacion-anual-note");
const activosTotalesNoteEl = document.getElementById("activos-totales-note");
const proyectosReferenciaTbody = document.getElementById("proyectos-referencia-tbody");
const auditMaxDistanceRaw = Number.parseFloat(form?.dataset?.auditMaxDistance || "");
const AUDIT_MAX_DISTANCE = Number.isFinite(auditMaxDistanceRaw) ? auditMaxDistanceRaw : 0.7;

let auditSelectedProjectIds = new Set();
let calculateRequestSequence = 0;

const tomSelectRefs = {};
let outsourcingOptionsLoaded = false;
let feeTbodyOriginal = "";
let hoursTbodyOriginal = "";

function initTomSelect() {
  ["departamento", "servicios-recurrentes", "tramites", "moneda", "tipo-negocio"].forEach((id) => {
    const node = document.getElementById(id);
    if (!node) return;

    const ts = new TomSelect(node, {
      create: false,
      sortField: { field: "text", direction: "asc" },
      plugins: node.hasAttribute("multiple") ? ["remove_button"] : [],
      maxOptions: 300,
    });

    tomSelectRefs[id] = ts;
  });
}

function updateTomSelectOptions(selectId, options) {
  const ts = tomSelectRefs[selectId];
  if (!ts) return;

  ts.clear(true);
  ts.clearOptions();
  ts.addOptions(options.map((option) => ({ value: option.value, text: option.label })));
  ts.refreshOptions(false);
}

async function ensureOutsourcingOptionsLoaded() {
  if (outsourcingOptionsLoaded) return;

  try {
    const response = await fetch("/api/outsourcing/options");
    if (!response.ok) {
      throw new Error("No se pudieron cargar las opciones de Outsourcing");
    }

    const data = await response.json();
    updateTomSelectOptions("servicios-recurrentes", data.servicios_recurrentes || []);
    updateTomSelectOptions("tramites", data.tramites || []);
    outsourcingOptionsLoaded = true;
  } catch (_error) {
    markdownPreview.innerHTML = "<p>No se pudieron cargar las opciones de Outsourcing.</p>";
  }
}

function setDepartmentSections() {
  const selected = departamentoEl.value;
  outsourcingSection.classList.toggle("hidden", selected !== "Outsourcing");
  auditoriaSection.classList.toggle("hidden", selected !== "Auditoria");
}

function numericValue(input) {
  const v = Number(input.value);
  return Number.isFinite(v) ? v : 0;
}

function averageFrom(selector) {
  const values = [...document.querySelectorAll(selector)]
    .map((el) => numericValue(el))
    .filter((n) => n > 0);

  if (values.length === 0) return 0;
  return values.reduce((acc, n) => acc + n, 0) / values.length;
}

function updateImplicitRate(avgFee, avgHours) {
  const implicitRate = avgHours > 0 ? avgFee / avgHours : 0;
  const hasValue = Number.isFinite(implicitRate) && implicitRate > 0;

  if (implicitRateLineEl) {
    implicitRateLineEl.classList.toggle("hidden", !hasValue);
  }

  if (implicitRateEl) {
    implicitRateEl.textContent = hasValue
      ? `${implicitRate.toLocaleString("es-PY", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} USD/hs`
      : "";
  }
}

function getImplicitRate(avgFee, avgHours) {
  if (!(avgHours > 0)) return 0;

  const implicitRate = avgFee / avgHours;
  return Number.isFinite(implicitRate) && implicitRate > 0 ? implicitRate : 0;
}

function getEmployeeAdjustmentRate(employeeCount) {
  if (employeeCount >= 51 && employeeCount <= 100) return 0.2;
  if (employeeCount >= 21 && employeeCount <= 50) return 0.1;
  return 0;
}

function refreshAverages() {
  const avgFee = averageFrom(".fee-value");
  const avgHours = averageFrom(".hour-value");

  if (avgFeeEl) {
    avgFeeEl.textContent = `${avgFee.toFixed(2)} USD`;
  }

  if (avgHoursEl) {
    avgHoursEl.textContent = `${avgHours.toFixed(2)} hs`;
  }

  updateImplicitRate(avgFee, avgHours);
}

function getRows(prefixProject, prefixValue, valueKey) {
  const rows = [];

  for (let i = 1; i <= 3; i += 1) {
    const project = form.elements[`${prefixProject}_${i}`]?.value?.trim() || "";
    const value = Number(form.elements[`${prefixValue}_${i}`]?.value || 0);

    if (project || value > 0) {
      rows.push({
        proyecto: project || `Proyecto ${i}`,
        [valueKey]: value,
      });
    }
  }

  return rows;
}

function toNumber(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return num;
}

function toAbsoluteMoney(value) {
  return toNumber(value) * 1000000;
}

function parseProjectId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function extractProjectId(row) {
  if (!row || typeof row !== "object") return null;

  const candidates = [
    row.idproyecto,
    row.proyecto_id,
    row.id_proyecto,
    row.propuesta_id,
    row.proyecto_historico_id,
    row.project_id,
    row.id,
  ];

  for (const value of candidates) {
    const projectId = parseProjectId(value);
    if (projectId !== null) return projectId;
  }

  return null;
}

function getSelectedComparableProjectIds() {
  if (!proyectosReferenciaTbody) return [];

  const checkedIds = [...proyectosReferenciaTbody.querySelectorAll("input.audit-project-checkbox:checked")]
    .map((input) => parseProjectId(input.dataset.projectId))
    .filter((id) => id !== null);

  return [...new Set(checkedIds)];
}

function getSelectableComparableProjectsCount() {
  if (!proyectosReferenciaTbody) return 0;
  return proyectosReferenciaTbody.querySelectorAll("input.audit-project-checkbox").length;
}

function refreshAuditFieldNotes() {
  const facturacionBase = form.elements.facturacion_anual?.value;
  const activosBase = form.elements.activos_totales?.value;

  const facturacionTotal = toAbsoluteMoney(facturacionBase);
  const activosTotal = toAbsoluteMoney(activosBase);

  if (facturacionAnualNoteEl) {
    facturacionAnualNoteEl.textContent = facturacionTotal.toLocaleString("es-PY", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  if (activosTotalesNoteEl) {
    activosTotalesNoteEl.textContent = activosTotal.toLocaleString("es-PY", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
}

function collectQuotationPayload() {
  const currency = document.getElementById("moneda")?.value || "USD";
  const showDetail = document.getElementById("honorarios-detallados")?.checked || false;
  const table = document.getElementById("obtener-lista-completa")?.checked || false;
  const monthlyVouchers = Number(form.elements.comprobantes_mensuales?.value || 0);
  const recurring = document.getElementById("servicios-recurrentes")?.value
    ? [...document.getElementById("servicios-recurrentes").selectedOptions].map((o) => ({ servicio_id: o.value }))
    : [];
  const occasional = document.getElementById("tramites")?.value
    ? [...document.getElementById("tramites").selectedOptions].map((o) => ({ servicio_id: o.value, cantidad: 1 }))
    : [];

  return {
    type: "OUT-LIST",
    configuracion: {
      table,
      moneda: currency,
      periodicidad: "mensual",
      mostrar_detalle: showDetail,
    },
    cliente: {
      comprobantes_mensuales: Number.isFinite(monthlyVouchers) ? monthlyVouchers : 0,
    },
    servicios_recurrentes: recurring,
    tramites_ocasionales: occasional,
  };
}

function collectAuditoriaPayload() {
  const selectedBusinessType = document.getElementById("tipo-negocio")?.value || "";
  const facturacionAnual = toNumber(form.elements.facturacion_anual?.value);
  const activosTotales = toNumber(form.elements.activos_totales?.value);
  const moneda = document.getElementById("auditoria-moneda")?.value || "PYG";
  const selectedProjects = getSelectedComparableProjectIds();

  auditSelectedProjectIds = new Set(selectedProjects);

  return {
    type: "AUDIT-A",
    rubro: selectedBusinessType ? selectedBusinessType.toUpperCase() : "",
    facturacion_anual: facturacionAnual,
    activos_totales: activosTotales,
    cantidad_empleados: Number(form.elements.cantidad_empleados?.value || 0),
    moneda,
    distancia_maxima: AUDIT_MAX_DISTANCE,
    proyectos_seleccionados: selectedProjects,
  };
}

function hasRequiredAuditoriaFields(payload) {
  return (
    Boolean(payload.rubro) &&
    payload.facturacion_anual > 0 &&
    payload.activos_totales > 0 &&
    payload.cantidad_empleados > 0 &&
    Boolean(payload.moneda)
  );
}

function numberText(value, maxFractionDigits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("es-PY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

function formatMonthYear(value) {
  if (!value) return "-";

  const str = String(value).trim();
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[2]}-${isoMatch[1]}`;
  }

  const monthMatch = str.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    return `${monthMatch[2]}-${monthMatch[1]}`;
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const year = String(parsed.getFullYear());
    return `${month}-${year}`;
  }

  return str;
}

function formatSimilarity(row) {
  const distance = Number(row?.puntaje_distancia);
  if (!Number.isFinite(distance)) return "-";

  const similarity = 100 / (1 + distance);
  return `distancia ${numberText(distance, 6)} -> similitud ${numberText(similarity, 2)}%`;
}

function renderAuditProjectsTable(resultados, moneda) {
  if (!proyectosReferenciaTbody) return;

  if (!resultados.length) {
    proyectosReferenciaTbody.innerHTML = '<tr><td colspan="12">No se encontraron proyectos comparables.</td></tr>';
    auditSelectedProjectIds = new Set();
    return;
  }

  const normalizedRows = resultados.map((row, index) => {
    const projectId = extractProjectId(row);
    const usedInCalculation = typeof row?.usado_en_calculo === "boolean" ? row.usado_en_calculo : null;

    return {
      ...row,
      __projectId: projectId,
      __isNearest: index === 0,
      __usedInCalculation: usedInCalculation,
    };
  });

  const previousSelection = new Set(auditSelectedProjectIds);
  const hasUsageFlags = normalizedRows.some((row) => typeof row.__usedInCalculation === "boolean");

  if (previousSelection.size === 0 && hasUsageFlags) {
    auditSelectedProjectIds = new Set(
      normalizedRows
        .filter((row) => row.__projectId !== null && row.__usedInCalculation === true)
        .map((row) => row.__projectId)
    );
  } else {
    auditSelectedProjectIds = previousSelection;
  }

  const validProjectIds = new Set(
    normalizedRows
      .filter((row) => row.__projectId !== null)
      .map((row) => row.__projectId)
  );

  auditSelectedProjectIds = new Set(
    [...auditSelectedProjectIds].filter((projectId) => validProjectIds.has(projectId))
  );

  if (!hasUsageFlags && auditSelectedProjectIds.size === 0) {
    const nearestProject = normalizedRows.find((row) => row.__isNearest && row.__projectId !== null);
    if (nearestProject) {
      auditSelectedProjectIds.add(nearestProject.__projectId);
    }
  }

  proyectosReferenciaTbody.innerHTML = normalizedRows
    .map(
      (row) => `<tr>
        <td>
          ${row.__projectId !== null
            ? `<input class="audit-project-checkbox" data-project-id="${row.__projectId}" type="checkbox" ${auditSelectedProjectIds.has(row.__projectId) ? "checked" : ""} ${row.__isNearest ? 'title="Proyecto más cercano"' : ""} />`
            : '<span class="audit-project-unavailable">Sin ID</span>'}
        </td>
        <td>${formatSimilarity(row)}</td>
        <td>${row.cliente || "-"}</td>
        <td>${row.tipo_negocio || "-"}</td>
        <td>${formatMonthYear(row.fecha_propuesta)}</td>
        <td>${numberText(row.cant_ejercicios, 0)}</td>
        <td>${row.ejercicio || "-"}</td>
        <td>${numberText(row.total_activo_mm, 3)}</td>
        <td>${numberText(row.total_ingreso_mm, 3)}</td>
        <td>${numberText(row.cantidad_empleados, 0)}</td>
        <td>${money(row.honorarios_convertidos ?? row.honorarios_historicos, moneda)}</td>
        <td>${numberText(row.horas_presupuestadas, 2)}</td>
      </tr>`
    )
    .join("");
}

function money(value, currency) {
  const digits = currency === "PYG" ? 0 : 2;
  return `${Number(value || 0).toLocaleString("es-PY", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency || "USD"}`;
}

function renderQuotationResult(data) {
  const safeName = (name, fallback = "Servicio") => {
    const cleaned = typeof name === "string" ? name.trim() : "";
    return cleaned || fallback;
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const toAmount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const normalizeRangeLabel = (from, to, fallbackLabel = "") => {
    const fromValue = Number(from);
    const toValue = Number(to);

    if (Number.isFinite(fromValue) && Number.isFinite(toValue)) {
      if (fromValue <= 0) {
        return `Hasta ${toValue} comprobantes al mes`;
      }
      if (toValue >= 999999) {
        return `Desde ${fromValue} comprobantes al mes`;
      }
      return `${fromValue} a ${toValue} comprobantes al mes`;
    }

    const label = String(fallbackLabel || "").trim();
    return label || "Sin rango de comprobantes";
  };

  const buildGroupedRows = (rows) => {
    const groups = new Map();

    rows.forEach((row) => {
      const key = row.groupKey || row.groupLabel;
      if (!groups.has(key)) {
        groups.set(key, {
          label: row.groupLabel,
          order: Number.isFinite(row.order) ? row.order : Number.MAX_SAFE_INTEGER,
          rows: [],
        });
      }
      groups.get(key).rows.push(row);
    });

    return [...groups.values()].sort((a, b) => a.order - b.order);
  };

  const currency = data.moneda || "USD";
  const generalTotal = data.resumen?.total_general || 0;
  const recurrentDetails = data.detalle?.servicios_recurrentes || [];
  const occasionalDetails = data.detalle?.tramites_ocasionales || [];
  const recurrentPriceTable = data.tabla_precios?.servicios_recurrentes || [];
  const occasionalPriceTable = data.tabla_precios?.tramites_ocasionales || [];

  const currencySuffix = currency?.toLowerCase() === "usd" ? "usd" : "pyg";
  const wantsCompleteList = Boolean(document.getElementById("obtener-lista-completa")?.checked);

  const selectedRecurrentRowsHtml = recurrentDetails.length
    ? recurrentDetails
        .map((row) => {
          const annual = toAmount(row[`precio_anual_${currencySuffix}`]);
          const monthly = toAmount(row[`precio_mensual_${currencySuffix}`]);
          const selectedRange = String(row.rango_aplicado || "").trim();
          const serviceLabel = selectedRange
            ? `${safeName(row.nombre)} (${selectedRange})`
            : safeName(row.nombre);

          return `<tr>
            <td>${escapeHtml(serviceLabel)}</td>
            <td class="money-cell">${escapeHtml(money(annual, currency))}</td>
            <td class="money-cell">${escapeHtml(money(monthly, currency))}</td>
          </tr>`;
        })
        .join("")
    : '<tr><td colspan="3">Sin servicios recurrentes seleccionados.</td></tr>';

  const selectedOccasionalRowsHtml = occasionalDetails.length
    ? occasionalDetails
        .map((row) => {
          const annual = toAmount(row[`precio_anual_${currencySuffix}`]);
          const monthly = toAmount(row[`precio_mensual_${currencySuffix}`] ?? row.subtotal);
          return `<tr>
            <td>${escapeHtml(safeName(row.nombre, "Trámite"))}</td>
            <td class="money-cell">${escapeHtml(money(annual, currency))}</td>
            <td class="money-cell">${escapeHtml(money(monthly, currency))}</td>
          </tr>`;
        })
        .join("")
    : '<tr><td colspan="3">Sin trámites ocasionales seleccionados.</td></tr>';

  const totalSelectedRecurrentAnnual = recurrentDetails.reduce(
    (sum, row) => sum + toAmount(row[`precio_anual_${currencySuffix}`]),
    0
  );
  const totalSelectedRecurrentMonthly = recurrentDetails.reduce(
    (sum, row) => sum + toAmount(row[`precio_mensual_${currencySuffix}`]),
    0
  );

  const totalSelectedOccasionalAnnual = occasionalDetails.reduce(
    (sum, row) => sum + toAmount(row[`precio_anual_${currencySuffix}`]),
    0
  );
  const totalSelectedOccasionalMonthly = occasionalDetails.reduce(
    (sum, row) => sum + toAmount(row[`precio_mensual_${currencySuffix}`] ?? row.subtotal),
    0
  );

  const totalSelectedAnnual = totalSelectedRecurrentAnnual + totalSelectedOccasionalAnnual;
  const totalSelectedMonthly = totalSelectedRecurrentMonthly + totalSelectedOccasionalMonthly;

  const groupedSourceRows = recurrentPriceTable.length
    ? recurrentPriceTable.flatMap((service) => {
        const serviceName = safeName(service?.nombre);
        const ranges = Array.isArray(service?.precios) ? service.precios : [];

        return ranges.map((price) => {
          const from = Number(price?.rango_desde ?? 0);
          const to = Number(price?.rango_hasta ?? 0);
          return {
            serviceName,
            annual: toAmount(price?.[`precio_anual_${currencySuffix}`]),
            monthly: toAmount(price?.[`precio_mensual_${currencySuffix}`]),
            groupKey: `${Number.isFinite(from) ? from : "x"}-${Number.isFinite(to) ? to : "x"}`,
            groupLabel: normalizeRangeLabel(from, to, ""),
            order: Number.isFinite(from) ? from : Number.MAX_SAFE_INTEGER,
          };
        });
      })
    : recurrentDetails.map((row, index) => {
        const rangeLabel = String(row.rango_aplicado || "").trim();
        return {
          serviceName: safeName(row.nombre),
          annual: toAmount(row[`precio_anual_${currencySuffix}`]),
          monthly: toAmount(row[`precio_mensual_${currencySuffix}`]),
          groupKey: rangeLabel || "sin-rango",
          groupLabel: rangeLabel || "Sin rango de comprobantes",
          order: index,
        };
      });

  const groupedRows = buildGroupedRows(groupedSourceRows);
  const totalAnnualGrouped = groupedSourceRows.reduce((sum, row) => sum + row.annual, 0);
  const totalMonthlyGrouped = groupedSourceRows.reduce((sum, row) => sum + row.monthly, 0);

  const groupedRowsHtml = groupedRows.length
    ? groupedRows
        .map((group) => {
          const groupHeader = `<tr class="outsourcing-group-row"><th colspan="3">${escapeHtml(
            group.label
          )}</th></tr>`;
          const serviceRows = group.rows
            .map(
              (row) => `<tr>
                <td>${escapeHtml(row.serviceName)}</td>
                <td class="money-cell">${escapeHtml(money(row.annual, currency))}</td>
                <td class="money-cell">${escapeHtml(money(row.monthly, currency))}</td>
              </tr>`
            )
            .join("");
          const groupAnnualTotal = group.rows.reduce((sum, row) => sum + row.annual, 0);
          const groupMonthlyTotal = group.rows.reduce((sum, row) => sum + row.monthly, 0);
          const groupTotalRow = `<tr class="outsourcing-group-total-row">
            <th>Total ${escapeHtml(group.label)}</th>
            <th class="money-cell">${escapeHtml(money(groupAnnualTotal, currency))}</th>
            <th class="money-cell">${escapeHtml(money(groupMonthlyTotal, currency))}</th>
          </tr>`;

          return `${groupHeader}${serviceRows}${groupTotalRow}`;
        })
        .join("")
    : `<tr><td colspan="3">Sin servicios recurrentes seleccionados.</td></tr>`;

  const selectedRecurringSection = `<h3>Servicios recurrentes seleccionados</h3>
      <table class="outsourcing-fees-table">
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Anuales</th>
            <th>Mensuales</th>
          </tr>
        </thead>
        <tbody>
          ${selectedRecurrentRowsHtml}
        </tbody>
        <tfoot>
          <tr>
            <th>Total recurrentes seleccionados</th>
            <th class="money-cell">${escapeHtml(money(totalSelectedRecurrentAnnual, currency))}</th>
            <th class="money-cell">${escapeHtml(money(totalSelectedRecurrentMonthly, currency))}</th>
          </tr>
        </tfoot>
      </table>`;

  const selectedOccasionalSection = `<h3>Trámites ocasionales seleccionados</h3>
      <table class="outsourcing-fees-table">
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Anuales</th>
            <th>Mensuales</th>
          </tr>
        </thead>
        <tbody>
          ${selectedOccasionalRowsHtml}
        </tbody>
        <tfoot>
          <tr>
            <th>Total ocasionales seleccionados</th>
            <th class="money-cell">${escapeHtml(money(totalSelectedOccasionalAnnual, currency))}</th>
            <th class="money-cell">${escapeHtml(money(totalSelectedOccasionalMonthly, currency))}</th>
          </tr>
        </tfoot>
      </table>`;

  const completeListSection = wantsCompleteList
    ? `<h3>Lista completa de honorarios de outsourcing</h3>
      <table class="outsourcing-fees-table">
        <thead>
          <tr>
            <th rowspan="2" class="service-col">Servicio</th>
            <th colspan="2">Honorarios ${escapeHtml(currency)}</th>
          </tr>
          <tr>
            <th>Anuales</th>
            <th>Mensuales</th>
          </tr>
        </thead>
        <tbody>
          ${groupedRowsHtml}
        </tbody>
        <tfoot>
          <tr>
            <th>Total lista completa</th>
            <th class="money-cell">${escapeHtml(money(totalAnnualGrouped, currency))}</th>
            <th class="money-cell">${escapeHtml(money(totalMonthlyGrouped, currency))}</th>
          </tr>
        </tfoot>
      </table>`
    : "";

  const occasionalCompleteRows = occasionalPriceTable
    .map((row) => {
      const serviceName = safeName(row?.nombre, "Trámite");
      const usdAverage = toAmount(row?.precio_mensual_usd ?? row?.precio_anual_usd);
      const pygAverage = toAmount(row?.precio_mensual_pyg ?? row?.precio_anual_pyg);

      return `<tr>
        <td>${escapeHtml(serviceName)}</td>
        <td class="money-cell">${escapeHtml(money(usdAverage, "USD"))}</td>
        <td class="money-cell">${escapeHtml(money(pygAverage, "PYG"))}</td>
      </tr>`;
    })
    .join("");

  const occasionalCompleteListSection = wantsCompleteList && occasionalDetails.length
    ? `<h3>Lista completa de honorarios ocasionales</h3>
      <table class="outsourcing-fees-table occasional-complete-table">
        <thead>
          <tr>
            <th rowspan="2" class="service-col">Servicios</th>
            <th>Honorarios US$ sin I.V.A.</th>
            <th>Honorarios Guaraníes sin I.V.A.</th>
          </tr>
          <tr>
            <th>Precio Promedio</th>
            <th>Precio Promedio</th>
          </tr>
        </thead>
        <tbody>
          ${
            occasionalCompleteRows ||
            '<tr><td colspan="3">No se encontraron trámites ocasionales para la lista completa.</td></tr>'
          }
        </tbody>
      </table>`
    : "";

  const html = `<h2>Servicios seleccionados para el cálculo</h2>
    ${selectedRecurringSection}
    ${selectedOccasionalSection}
    <table class="outsourcing-fees-table">
      <thead>
        <tr>
          <th>Total de servicios seleccionados</th>
          <th>Anuales</th>
          <th>Mensuales</th>
        </tr>
      </thead>
      <tfoot>
        <tr>
          <th>Importe total seleccionado</th>
          <th class="money-cell">${escapeHtml(money(totalSelectedAnnual, currency))}</th>
          <th class="money-cell">${escapeHtml(money(totalSelectedMonthly, currency))}</th>
        </tr>
      </tfoot>
    </table>
    ${completeListSection}
    ${occasionalCompleteListSection}`;

  markdownPreview.innerHTML = html;
  totalOutput.textContent = money(generalTotal, currency);
}

function renderAuditoriaResult(data) {
  const resultados = data.resultados || [];
  const resultadosTomados = resultados.filter((row) => row?.usado_en_calculo === true);
  const resultadosParaMostrar = resultadosTomados.length ? resultadosTomados : resultados;
  const moneda = data.moneda || data.datos_entrada?.moneda || "PYG";
  const datosReferencia = data.datos_referencia || {};
  const ajustes = data.ajustes_aplicados || {};
  const pasos = data.pasos_calculo || [];
  const resultadoFinal = data.resultado_final || {};

  const auditFieldLabels = {
    factor_inflacion: "Factor por Inflación",
    fecha_ipc_actual: "Fecha IPC actual",
    fecha_ipc_base: "Fecha IPC base",
    honorario_promedio: "Honorario Promedio",
    horas_promedio: "Horas Promedio",
    ipc_indice_actual: "IPC (índice actual)",
    ipc_indice_base: "IPC (índice base)",
    tarifa_implicita: "Tarifa Implícita",
    ajuste_complejidad_pct: "Ajuste de Complejidad",
    ajuste_empleados_pct: "Ajuste por cant. de empleados",
    ajuste_total_pct: "Ajuste total",
    honorario_sugerido: "Honorario Sugerido",
    horas_estimadas: "Horas estimadas",
    rango_maximo: "Rango máximo",
    rango_minimo: "Rango mínimo",
    tarifa_ajustada: "Tarifa ajustada",
  };

  const getAuditLabel = (key) => auditFieldLabels[key] || key;

  renderAuditProjectsTable(resultados, moneda);

  const proyectosMarkdown = resultadosParaMostrar.length
    ? resultadosParaMostrar
        .map(
          (row) =>
            `| ${formatSimilarity(row)} | ${row.cliente || "-"} | ${row.tipo_negocio || "-"} | ${formatMonthYear(row.fecha_propuesta)} | ${numberText(row.cant_ejercicios, 0)} | ${row.ejercicio || "-"} | ${numberText(row.total_activo_mm, 3)} | ${numberText(row.total_ingreso_mm, 3)} | ${numberText(row.cantidad_empleados, 0)} | ${money(row.honorarios_convertidos ?? row.honorarios_historicos, moneda)} | ${numberText(row.horas_presupuestadas, 2)} |`
        )
        .join("\n")
    : "Sin proyectos comparables.";

  const referenciaMarkdown = Object.keys(datosReferencia).length
    ? Object.entries(datosReferencia)
        .map(([key, value]) => {
          const label = getAuditLabel(key);
          if (key.includes("honorario") || key.includes("tarifa")) {
            return `- ${label}: ${money(value, moneda)}`;
          }
          if (typeof value === "number") {
            return `- ${label}: ${numberText(value, 6)}`;
          }
          return `- ${label}: ${value}`;
        })
        .join("\n")
    : "- Sin datos de referencia.";

  const ajustesMarkdown = Object.keys(ajustes).length
    ? Object.entries(ajustes)
        .map(([key, value]) => `- ${getAuditLabel(key)}: ${numberText((Number(value) || 0) * 100, 2)}%`)
        .join("\n")
    : "- Sin ajustes aplicados.";

  const pasosMarkdown = pasos.length
    ? pasos
        .map((paso) => {
          const nombrePaso = (paso.nombre || "").toLowerCase();
          const isHoursStep = nombrePaso.includes("hora") || nombrePaso === "ajustes por negocio";
          const formattedValue = isHoursStep
            ? `${numberText(paso.valor, 2)} hs`
            : money(paso.valor, moneda);

          return `${paso.paso}. **${paso.nombre || "Paso"}**\n   - Detalle: ${paso.detalle || "-"}\n   - Valor: ${formattedValue}`;
        })
        .join("\n")
    : "Sin pasos de cálculo.";

  const resultadoMarkdown = Object.keys(resultadoFinal).length
    ? Object.entries(resultadoFinal)
        .map(([key, value]) => {
          const label = getAuditLabel(key);
          if (key.includes("horas")) {
            return `- ${label}: ${numberText(value, 2)}`;
          }
          return `- ${label}: ${money(value, moneda)}`;
        })
        .join("\n")
    : "- Sin resultado final.";

  const markdown = [
    "## Estimación de Auditoría",
    "",
    "### Proyectos tomados en cuenta",
    "| Índice de similitud | Cliente | Tipo de negocio | Fecha propuesta | Cant. ejercicios | Ejercicio | Activo | Ingreso | Cant. empleados | Honorarios | Horas |",
    "| :--- | :--- | :--- | :--- | ---: | :--- | ---: | ---: | ---: | ---: | ---: |",
    proyectosMarkdown,
    "",
    "### Datos de referencia",
    referenciaMarkdown,
    "",
    "### Ajustes aplicados",
    ajustesMarkdown,
    "",
    "### Pasos del cálculo",
    pasosMarkdown,
    "",
    "### Resultado final",
    resultadoMarkdown,
  ].join("\n");

  markdownPreview.innerHTML = marked.parse(markdown);
  totalOutput.textContent = money(resultadoFinal.honorario_sugerido || 0, moneda);
}

async function calculateFees() {
  if (!departamentoEl.value) {
    markdownPreview.innerHTML = "<p>Selecciona un departamento para calcular.</p>";
    totalOutput.textContent = "0.00 USD";
    return;
  }

  const payload = departamentoEl.value === "Auditoria"
    ? collectAuditoriaPayload()
    : collectQuotationPayload();

  if (departamentoEl.value === "Auditoria" && !hasRequiredAuditoriaFields(payload)) {
    markdownPreview.innerHTML =
      "<p>Completa todos los campos requeridos de Auditoría (rubro, facturación, activos, empleados y moneda) para consultar el cálculo.</p>";
    totalOutput.textContent = "0.00";
    if (proyectosReferenciaTbody) {
      proyectosReferenciaTbody.innerHTML = '<tr><td colspan="12">Completa los datos requeridos para consultar los proyectos comparables.</td></tr>';
      auditSelectedProjectIds = new Set();
    }
    return;
  }

  if (departamentoEl.value === "Auditoria") {
    const selectableProjects = getSelectableComparableProjectsCount();
    const selectedProjects = getSelectedComparableProjectIds();

    if (selectableProjects > 0 && selectedProjects.length === 0) {
      markdownPreview.innerHTML =
        "<p>Selecciona al menos un proyecto comparable para recalcular. Si no hay proyectos seleccionados, no se envía nada al servicio.</p>";
      totalOutput.textContent = "0.00";
      auditSelectedProjectIds = new Set();
      return;
    }
  }

  try {
    const requestSequence = ++calculateRequestSequence;
    const response = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (requestSequence !== calculateRequestSequence) {
      return;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "No se pudo calcular");
    }

    const data = await response.json();
    if (requestSequence !== calculateRequestSequence) {
      return;
    }

    if (data.type === "AUDIT-A") {
      renderAuditoriaResult(data);
    } else {
      renderQuotationResult(data);
    }
  } catch (_error) {
    markdownPreview.innerHTML = "<p>No se pudo calcular el estimado en este momento.</p>";
  }
}

async function copyFormattedResult() {
  const btn = document.getElementById("copy-result-btn");
  const html = markdownPreview.innerHTML;
  const text = markdownPreview.innerText;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
  } catch (_e) {
    await navigator.clipboard.writeText(text);
  }

  if (btn) {
    btn.classList.add("copied");
    btn.textContent = "¡Copiado!";
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`;
    }, 2000);
  }
}

function debounce(fn, wait = 320) {
  let timerId = null;
  return (...args) => {
    window.clearTimeout(timerId);
    timerId = window.setTimeout(() => fn(...args), wait);
  };
}

function setupDragDrop() {
  if (!dropzone || !fileInput) return;

  const updateCounter = () => {
    const count = fileInput.files?.length || 0;
    fileCounter.textContent = count > 0 ? `${count} archivo(s) cargado(s)` : "Ningún archivo cargado.";
    calculateFeesDebounced();
  };

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((evtName) => {
    dropzone.addEventListener(evtName, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((evtName) => {
    dropzone.addEventListener(evtName, () => {
      dropzone.classList.remove("is-dragover");
    });
  });

  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    fileInput.files = event.dataTransfer.files;
    updateCounter();
  });

  fileInput.addEventListener("change", updateCounter);
}

const calculateFeesDebounced = debounce(() => {
  refreshAverages();
  calculateFees();
}, 300);

function setupEvents() {
  form.addEventListener("input", calculateFeesDebounced);
  form.addEventListener("change", calculateFeesDebounced);
  form.addEventListener("input", refreshAuditFieldNotes);
  form.addEventListener("change", refreshAuditFieldNotes);
  form.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains("audit-project-checkbox")) return;

    auditSelectedProjectIds = new Set(getSelectedComparableProjectIds());
  });

  const copyBtn = document.getElementById("copy-result-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", copyFormattedResult);
  }
  departamentoEl.addEventListener("change", async () => {
    updateImplicitRate(0, 0);
    setDepartmentSections();
    if (departamentoEl.value === "Outsourcing") {
      await ensureOutsourcingOptionsLoaded();
    }
    calculateFeesDebounced();
  });
}

async function main() {
  initTomSelect();
  setupEvents();
  setupDragDrop();
  setDepartmentSections();
  if (departamentoEl.value === "Outsourcing") {
    await ensureOutsourcingOptionsLoaded();
  }
  refreshAuditFieldNotes();
  refreshAverages();
  calculateFees();
}

main();
