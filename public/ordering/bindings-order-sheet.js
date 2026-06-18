export function bindOrderingDailyOrder({
  dailyOrderList,
  jumpToItem,
  deliverDailyOrder,
  deleteDailyOrder,
  setMessage
}) {
  dailyOrderList.addEventListener("click", (event) => {
    const jumpButton = event.target.closest(".order-sheet-item-link");
    if (jumpButton) {
      jumpToItem(jumpButton.dataset.jumpItemId, jumpButton.dataset.jumpCategory);
      return;
    }

    const deliverButton = event.target.closest(".deliver-order-button");
    if (deliverButton) {
      if (!window.confirm("Mark this item as received and add it to inventory?")) return;
      deliverButton.disabled = true;
      deliverDailyOrder(deliverButton.dataset.deliverId).catch((error) => {
        setMessage(error.message, true);
        deliverButton.disabled = false;
      });
      return;
    }

    const button = event.target.closest(".delete-order-button");
    if (!button) return;
    if (!window.confirm("Remove this item from the order list?")) return;

    button.disabled = true;
    deleteDailyOrder(button.dataset.requestId).catch((error) => {
      setMessage(error.message, true);
      button.disabled = false;
    });
  });
}

export function bindOrderingNotifications({
  notificationList,
  markNotificationsRead,
  setMessage
}) {
  notificationList?.addEventListener("click", (event) => {
    const button = event.target.closest(".mark-notification-read");
    if (!button) return;
    const row = button.closest("[data-notification-id]");
    if (!row?.dataset.notificationId) return;
    button.disabled = true;
    markNotificationsRead([row.dataset.notificationId]).catch((error) => {
      setMessage(error.message, true);
      button.disabled = false;
    });
  });
}
