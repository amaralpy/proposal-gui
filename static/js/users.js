const usersTableBody = document.getElementById("users-table-body");
const usersFeedback = document.getElementById("users-feedback");
const usersRefreshBtn = document.getElementById("users-refresh");
const usersCount = document.getElementById("users-count");
const activeUsersCount = document.getElementById("active-users-count");
const rolesCount = document.getElementById("roles-count");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setUsersFeedback(message, isError = false) {
  if (!usersFeedback) return;
  usersFeedback.textContent = message;
  usersFeedback.classList.toggle("error", isError);
}

function fmtDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-PY");
}

function renderRoleOptions(selectedRole, roles) {
  return roles
    .map(
      (role) =>
        `<option value="${escapeHtml(role.code)}" ${role.code === selectedRole ? "selected" : ""}>${escapeHtml(role.label)}</option>`,
    )
    .join("");
}

async function saveUserAccess(username, role, isActive) {
  const response = await fetch(`/api/rbac/users/${encodeURIComponent(username)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, is_active: isActive }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "No se pudo actualizar el usuario");
  }
}

function attachUserEvents() {
  document.querySelectorAll(".user-save").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      if (!row) return;
      const username = button.dataset.user;
      const roleSelect = row.querySelector(".role-select");
      const activeToggle = row.querySelector(".active-toggle");
      if (!username || !roleSelect || !activeToggle) return;

      try {
        await saveUserAccess(username, roleSelect.value, activeToggle.checked);
        setUsersFeedback(`Acceso actualizado para ${username}`);
      } catch (error) {
        setUsersFeedback(error.message, true);
      }
    });
  });
}

function renderUsers(users, roles) {
  if (!usersTableBody) return;

  usersCount.textContent = String(users.length);
  activeUsersCount.textContent = String(users.filter((user) => user.is_active).length);
  rolesCount.textContent = String(roles.length);

  usersTableBody.innerHTML = users
    .map((user) => {
      const isCurrentUser = user.username === window.currentUsername;
      const isDisabled = !window.canManageUsers || isCurrentUser;
      return `
        <tr>
          <td>${escapeHtml(user.username)}</td>
          <td>${escapeHtml(user.full_name || user.username)}</td>
          <td>${escapeHtml(user.email || "-")}</td>
          <td>
            <select class="role-select" ${isDisabled ? "disabled" : ""}>
              ${renderRoleOptions(user.role, roles)}
            </select>
          </td>
          <td>
            <label class="table-toggle">
              <input class="active-toggle" type="checkbox" ${user.is_active ? "checked" : ""} ${isDisabled ? "disabled" : ""} />
              <span>${user.is_active ? "Activo" : "Inactivo"}</span>
            </label>
          </td>
          <td>${fmtDate(user.last_login_at)}</td>
          <td>
            <button class="secondary-btn user-save" data-user="${escapeHtml(user.username)}" ${isDisabled ? "disabled" : ""}>Guardar</button>
          </td>
        </tr>
      `;
    })
    .join("");

  attachUserEvents();
}

async function loadUsers() {
  setUsersFeedback("");
  try {
    const response = await fetch("/api/rbac/users");
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "No se pudo cargar la lista de usuarios");
    }

    const data = await response.json();
    renderUsers(data.users || [], data.roles || []);
  } catch (error) {
    setUsersFeedback(error.message, true);
  }
}

if (usersRefreshBtn) {
  usersRefreshBtn.addEventListener("click", loadUsers);
}

loadUsers();