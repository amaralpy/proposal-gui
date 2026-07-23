const rolesGrid = document.getElementById("roles-grid");
const rolesFeedback = document.getElementById("roles-feedback");
const rolesRefreshBtn = document.getElementById("roles-refresh");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setRolesFeedback(message, isError = false) {
  if (!rolesFeedback) return;
  rolesFeedback.textContent = message;
  rolesFeedback.classList.toggle("error", isError);
}

function groupPermissions(permissions) {
  return permissions.reduce((groups, permission) => {
    const module = permission.module || "general";
    groups[module] = groups[module] || [];
    groups[module].push(permission);
    return groups;
  }, {});
}

async function saveRolePermissions(roleCode, permissions) {
  const response = await fetch(`/api/rbac/roles/${encodeURIComponent(roleCode)}/permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissions }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "No se pudo actualizar el rol");
  }
}

function attachRoleEvents() {
  document.querySelectorAll(".role-save-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".role-editor-card");
      if (!card) return;
      const roleCode = card.dataset.role;
      const selectedPermissions = Array.from(card.querySelectorAll("input[type='checkbox']:checked")).map(
        (input) => input.value,
      );

      try {
        await saveRolePermissions(roleCode, selectedPermissions);
        setRolesFeedback(`Permisos actualizados para ${roleCode}`);
      } catch (error) {
        setRolesFeedback(error.message, true);
      }
    });
  });
}

function renderRoles(roles, permissions) {
  if (!rolesGrid) return;

  const groupedPermissions = groupPermissions(permissions);
  rolesGrid.innerHTML = roles
    .map((role) => {
      const permissionSet = new Set(role.permissions || []);
      const modulesMarkup = Object.entries(groupedPermissions)
        .map(([module, modulePermissions]) => {
          const checks = modulePermissions
            .map(
              (permission) => `
                <label class="permission-item">
                  <input
                    type="checkbox"
                    value="${escapeHtml(permission.code)}"
                    ${permissionSet.has(permission.code) ? "checked" : ""}
                    ${window.canManageRoles ? "" : "disabled"}
                  />
                  <span>
                    <strong>${escapeHtml(permission.label)}</strong>
                    <small>${escapeHtml(permission.description)}</small>
                  </span>
                </label>
              `,
            )
            .join("");

          return `
            <section class="permission-module">
              <h3>${escapeHtml(module)}</h3>
              <div class="permission-list">${checks}</div>
            </section>
          `;
        })
        .join("");

      return `
        <article class="role-editor-card" data-role="${escapeHtml(role.code)}">
          <header>
            <div>
              <h2>${escapeHtml(role.label)}</h2>
              <p>${escapeHtml(role.description)}</p>
            </div>
            <span class="permission-counter">${(role.permissions || []).length} permisos</span>
          </header>
          ${modulesMarkup}
          <div class="role-card-actions">
            <button class="primary-btn role-save-btn" type="button" ${window.canManageRoles ? "" : "disabled"}>Guardar</button>
          </div>
        </article>
      `;
    })
    .join("");

  attachRoleEvents();
}

async function loadRoles() {
  setRolesFeedback("");
  try {
    const response = await fetch("/api/rbac/roles");
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "No se pudieron cargar los roles");
    }

    const data = await response.json();
    renderRoles(data.roles || [], data.permissions || []);
  } catch (error) {
    setRolesFeedback(error.message, true);
  }
}

if (rolesRefreshBtn) {
  rolesRefreshBtn.addEventListener("click", loadRoles);
}

loadRoles();