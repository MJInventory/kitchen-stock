import {
  escapeHtml,
  formatLastLogin,
  matchesSearch,
  roleLabel,
  userMetaBadges
} from "./helpers.js";

export function filterUsers(users, { term, wantedRole, wantedStatus }) {
  return users.filter((user) => {
    if (wantedRole !== "all" && user.role !== wantedRole) return false;
    if (wantedStatus === "active" && !user.active) return false;
    if (wantedStatus === "inactive" && user.active) return false;
    if (wantedStatus === "must-change" && !user.mustChangePassword) return false;
    if (wantedStatus === "drivers" && !user.isDriver) return false;
    if (wantedStatus === "pickers" && !user.isPicker) return false;
    if (wantedStatus === "kitchen-staff" && !user.isKitchenStaff) return false;
    return matchesSearch(user, term);
  });
}

export function updateUserCount(filtered, total, userCount) {
  if (!userCount) return;
  if (!total) {
    userCount.textContent = "No users found yet.";
    return;
  }
  userCount.textContent = filtered === total
    ? `${total} user${total === 1 ? "" : "s"} shown.`
    : `${filtered} of ${total} user${total === 1 ? "" : "s"} shown.`;
}

export function renderUsers({
  users,
  filters,
  userList,
  userCount
}) {
  const filteredUsers = filterUsers(users, filters);
  updateUserCount(filteredUsers.length, users.length, userCount);
  if (!filteredUsers.length) {
    userList.innerHTML = `<article class="panel empty-state-panel"><p>No users match the current filters.</p></article>`;
    return;
  }
  userList.innerHTML = filteredUsers.map((user) => `
    <article class="user-admin-card" data-user-id="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.name)}">
      <button class="user-admin-summary" type="button" aria-expanded="false">
        <div class="user-admin-summary-main">
          <strong>${escapeHtml(user.name)}</strong>
          <span>${user.editable ? "Online user" : "Render user - move to App Users to edit"}</span>
          <span>${escapeHtml(formatLastLogin(user.lastLoginAt))}</span>
        </div>
        <div class="user-admin-summary-side">
          <div class="user-admin-pill-row">${userMetaBadges(user)}</div>
          <span class="user-admin-open-text">Open details</span>
        </div>
      </button>
      <div class="user-admin-body">
        <div class="user-admin-sections">
          <section class="user-admin-section">
            <h3>Access</h3>
            <div class="user-admin-fields">
              <label>Role
                <select class="user-role" ${user.editable && user.canEditRole ? "" : "disabled"}>
                  <option value="user"${user.role === "user" ? " selected" : ""}>User</option>
                  <option value="staff"${user.role === "staff" ? " selected" : ""}>Staff</option>
                  <option value="power-user"${user.role === "power-user" ? " selected" : ""}>Power User</option>
                  <option value="admin"${user.role === "admin" ? " selected" : ""}>Admin</option>
                  <option value="god"${user.role === "god" ? " selected" : ""}>God</option>
                </select>
              </label>
              <input class="user-theme" type="hidden" value="light">
              <label>New password
                <input class="user-password" type="text" placeholder="Leave blank to keep current" ${user.editable && user.canSave ? "" : "disabled"}>
              </label>
            </div>
            <div class="user-admin-toggle-row">
              <label class="check-label"><input class="user-active" type="checkbox" ${user.active ? "checked" : ""} ${user.editable ? "" : "disabled"}> Active</label>
              <label class="check-label"><input class="user-must-change" type="checkbox" ${user.mustChangePassword ? "checked" : ""} ${user.editable ? "" : "disabled"}> Force password change</label>
            </div>
          </section>

          <section class="user-admin-section">
            <h3>Work Flow</h3>
            <div class="user-admin-toggle-row">
              <label class="check-label"><input class="user-is-driver" type="checkbox" ${user.isDriver ? "checked" : ""} ${user.editable ? "" : "disabled"}> Dedicated driver</label>
              <label class="check-label"><input class="user-is-picker" type="checkbox" ${user.isPicker ? "checked" : ""} ${user.editable ? "" : "disabled"}> Picker</label>
              <label class="check-label"><input class="user-is-kitchen-staff" type="checkbox" ${user.isKitchenStaff ? "checked" : ""} ${user.editable ? "" : "disabled"}> Kitchen Staff</label>
              <label>Kitchen function
                <select class="user-kitchen-function" ${user.editable ? "" : "disabled"}>
                  <option value=""${!user.kitchenFunction ? " selected" : ""}>Choose function</option>
                  <option value="Chef"${user.kitchenFunction === "Chef" ? " selected" : ""}>Chef</option>
                  <option value="Sous-Chef"${user.kitchenFunction === "Sous-Chef" ? " selected" : ""}>Sous-Chef</option>
                  <option value="Line Cook"${user.kitchenFunction === "Line Cook" ? " selected" : ""}>Line Cook</option>
                  <option value="Kitchen Helper"${user.kitchenFunction === "Kitchen Helper" ? " selected" : ""}>Kitchen Helper</option>
                  <option value="Dishwasher"${user.kitchenFunction === "Dishwasher" ? " selected" : ""}>Dishwasher</option>
                  <option value="Pickup Waiter"${user.kitchenFunction === "Pickup Waiter" ? " selected" : ""}>Pickup Waiter</option>
                  <option value="Other"${user.kitchenFunction === "Other" ? " selected" : ""}>Other</option>
                </select>
              </label>
              <label class="check-label"><input class="user-notify-orders" type="checkbox" ${user.notifyOnNewOrders ? "checked" : ""} ${user.editable ? "" : "disabled"}> Notify on new orders</label>
              <label class="check-label"><input class="user-notify-delivery" type="checkbox" ${user.notifyOnDelivery ? "checked" : ""} ${user.editable ? "" : "disabled"}> Notify on delivered items</label>
            </div>
          </section>

          <section class="user-admin-section user-admin-section-wide">
            <h3>Notify For Area Orders</h3>
            <div class="notify-area-grid compact">
              <label class="check-label"><input class="user-notify-area-bar" type="checkbox" ${user.notifyAreas?.bar !== false ? "checked" : ""} ${user.editable ? "" : "disabled"}> Bar</label>
              <label class="check-label"><input class="user-notify-area-foh" type="checkbox" ${user.notifyAreas?.foh !== false ? "checked" : ""} ${user.editable ? "" : "disabled"}> FOH</label>
              <label class="check-label"><input class="user-notify-area-kitchen" type="checkbox" ${user.notifyAreas?.kitchen !== false ? "checked" : ""} ${user.editable ? "" : "disabled"}> Kitchen</label>
              <label class="check-label"><input class="user-notify-area-general" type="checkbox" ${user.notifyAreas?.general !== false ? "checked" : ""} ${user.editable ? "" : "disabled"}> General</label>
            </div>
          </section>
        </div>
        <div class="user-admin-actions">
          ${user.canDelete ? '<button class="danger-button delete-user" type="button">Delete User</button>' : ""}
        </div>
      </div>
    </article>
  `).join("");
}
