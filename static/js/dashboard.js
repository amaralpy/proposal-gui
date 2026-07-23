const tableBody = document.getElementById("roles-table-body");
const feedback = document.getElementById("roles-feedback");
const refreshBtn = document.getElementById("roles-refresh");

function setFeedback(message, isError = false) {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("error", isError);
}

function fmtDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-PY");
}

function roleOptions(currentRole, roles) {
  return roles
    .map((role) => `<option value="${role}" ${role === currentRole ? "selected" : ""}>${role}</option>`)
    .join("");
}

async function updateRole(username, role) {
  const response = await fetch(`/api/roles/users/${encodeURIComponent(username)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "No se pudo actualizar el rol");
  }
}

function renderRows(users, roles) {
  tableBody.innerHTML = users
    .map((user) => {
      const disabled = user.username === window.currentUsername ? "disabled" : "";
      return `
        <tr>
          <td>${user.username}</td>
          <td>
            <select data-user="${user.username}" class="role-select" ${disabled}>
              ${roleOptions(user.role, roles)}
            </select>
          </td>
          <td>${fmtDate(user.last_login_at)}</td>
          <td>
            <button class="secondary-btn role-save" data-user="${user.username}" ${disabled}>Guardar</button>
          </td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".role-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const username = btn.dataset.user;
      const select = document.querySelector(`select[data-user="${username}"]`);
      if (!select) return;
      try {
        await updateRole(username, select.value);
        setFeedback(`Rol actualizado para ${username}`);
      } catch (error) {
        setFeedback(error.message, true);
      }
    });
  });
}

async function loadUsers() {
  setFeedback("");
  try {
    const response = await fetch("/api/roles/users");
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "No se pudo obtener usuarios");
    }

    const data = await response.json();
    renderRows(data.users || [], data.roles || []);
  } catch (error) {
    setFeedback(error.message, true);
  }
}

if (refreshBtn) {
  refreshBtn.addEventListener("click", loadUsers);
}

loadUsers();
