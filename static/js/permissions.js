const permissionsTable = document.getElementById("permissions-matrix");
const permissionsFeedback = document.getElementById("permissions-feedback");
const permissionsRefreshBtn = document.getElementById("permissions-refresh");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setPermissionsFeedback(message, isError = false) {
  if (!permissionsFeedback) return;
  permissionsFeedback.textContent = message;
  permissionsFeedback.classList.toggle("error", isError);
}

function renderPermissions(permissions, roles) {
  if (!permissionsTable) return;

  const rolePermissions = Object.fromEntries(
    roles.map((role) => [role.code, new Set(role.permissions || [])]),
  );

  permissionsTable.querySelector("thead").innerHTML = `
    <tr>
      <th>Módulo</th>
      <th>Permiso</th>
      <th>Descripción</th>
      ${roles.map((role) => `<th>${escapeHtml(role.label)}</th>`).join("")}
    </tr>
  `;

  permissionsTable.querySelector("tbody").innerHTML = permissions
    .map(
      (permission) => `
        <tr>
          <td>${escapeHtml(permission.module)}</td>
          <td>
            <div class="permission-code">${escapeHtml(permission.code)}</div>
            <strong>${escapeHtml(permission.label)}</strong>
          </td>
          <td>${escapeHtml(permission.description)}</td>
          ${roles
            .map((role) => {
              const enabled = rolePermissions[role.code]?.has(permission.code);
              return `<td><span class="matrix-pill ${enabled ? "enabled" : "disabled"}">${enabled ? "Sí" : "No"}</span></td>`;
            })
            .join("")}
        </tr>
      `,
    )
    .join("");
}

async function loadPermissions() {
  setPermissionsFeedback("");
  try {
    const response = await fetch("/api/rbac/permissions");
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "No se pudieron cargar los permisos");
    }

    const data = await response.json();
    renderPermissions(data.permissions || [], data.roles || []);
  } catch (error) {
    setPermissionsFeedback(error.message, true);
  }
}

if (permissionsRefreshBtn) {
  permissionsRefreshBtn.addEventListener("click", loadPermissions);
}

loadPermissions();