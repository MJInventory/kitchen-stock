export function formatUserDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw !== raw.toLowerCase()) return raw;
  return raw
    .split(/\s+/)
    .map((part) => part
      .split("-")
      .map((piece) => piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece)
      .join("-"))
    .join(" ");
}

export function formatLastLogin(value) {
  if (!value) return "Never logged in";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `Last login: ${value}`;
  return `Last login: ${date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

export function roleLabel(role) {
  return role === "god" ? "God"
    : role === "admin" ? "Admin"
    : role === "power-user" ? "Power User"
    : role === "staff" ? "Staff"
    : "User";
}

export function matchesSearch(user, term) {
  if (!term) return true;
  const haystack = [
    user.name,
    roleLabel(user.role),
    user.isDriver ? "driver" : "",
    user.isPicker ? "picker" : "",
    user.isKitchenStaff ? "kitchen staff" : "",
    user.kitchenFunction || "",
    user.active ? "active" : "inactive",
    user.mustChangePassword ? "password change" : "",
    user.notifyOnNewOrders ? "new orders" : "",
    user.notifyOnDelivery ? "delivery" : ""
  ].join(" ").toLowerCase();
  return haystack.includes(term);
}

export function userMetaBadges(user) {
  return [
    `<span class="user-meta-pill role">${escapeHtml(roleLabel(user.role))}</span>`,
    user.active ? `<span class="user-meta-pill ok">Active</span>` : `<span class="user-meta-pill muted">Inactive</span>`,
    user.mustChangePassword ? `<span class="user-meta-pill warn">Change password</span>` : "",
    user.isDriver ? `<span class="user-meta-pill accent">Driver</span>` : "",
    user.isPicker ? `<span class="user-meta-pill accent">Picker</span>` : "",
    user.isKitchenStaff ? `<span class="user-meta-pill accent">Kitchen Staff</span>` : "",
    user.kitchenFunction ? `<span class="user-meta-pill info">${escapeHtml(user.kitchenFunction)}</span>` : "",
    user.notifyOnNewOrders ? `<span class="user-meta-pill info">Order alerts</span>` : "",
    user.notifyOnDelivery ? `<span class="user-meta-pill info">Delivery alerts</span>` : ""
  ].filter(Boolean).join("");
}
