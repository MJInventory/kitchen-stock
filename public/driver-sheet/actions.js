export function updateRequestFromLine(currentSheet, line) {
  currentSheet.requests = currentSheet.requests.map((request) => {
    if (request.driverLineId !== line.id) return request;
    return {
      ...request,
      ordered: line.ordered,
      toDeliver: line.toDeliver,
      deliveryDay: line.deliveryDay || "",
      driverName: line.driverName || request.driverName,
      delivered: line.received || request.delivered,
      supplierName: line.supplierName || request.supplierName,
      supplierContact: line.supplierContact || request.supplierContact,
      unit: line.unit || request.unit,
      quantity: line.quantity ?? request.quantity
    };
  });
}

export function createDriverSheetActions({
  api,
  setMessage,
  renderCurrentSheet,
  loadSheet,
  chooseSupplierChangeMode
}) {
  async function toggleOrdered(row, button, currentSheet) {
    const lineId = row.dataset.lineId;
    const ordered = !button.classList.contains("checked");
    button.disabled = true;
    setMessage("Saving ordered status...");
    try {
      const { line } = await api(`/api/driver-lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify({ ordered })
      });
      updateRequestFromLine(currentSheet, line);
      renderCurrentSheet(currentSheet);
      setMessage("");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function markDelivered(row, button) {
    const lineId = row.dataset.lineId;
    const requestId = row.dataset.requestId;
    if (button.classList.contains("checked")) return;
    button.disabled = true;
    setMessage("Marking delivered and updating stock...");
    try {
      await api(`/api/driver-lines/${lineId}/deliver`, {
        method: "POST",
        body: JSON.stringify({ requestId })
      });
      await loadSheet();
      setMessage("Delivered. Stock updated.");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function toggleToDeliver(row, button, currentSheet) {
    const lineId = row.dataset.lineId;
    const toDeliver = !button.classList.contains("checked");
    const deliveryDay = row.querySelector(".delivery-day-input")?.value || "";
    button.disabled = true;
    setMessage("Saving 2Deliver status...");
    try {
      const { line } = await api(`/api/driver-lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify({ toDeliver, deliveryDay })
      });
      updateRequestFromLine(currentSheet, line);
      if (toDeliver) {
        const orderedButton = row.querySelector('[data-action="ordered"]');
        if (orderedButton && !orderedButton.classList.contains("checked")) {
          orderedButton.classList.add("checked");
          orderedButton.innerHTML = "&#10003;";
        }
      }
      renderCurrentSheet(currentSheet);
      setMessage("");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function changeDeliveryDay(row, input, currentSheet) {
    const lineId = row.dataset.lineId;
    const deliveryDay = String(input.value || "").trim();
    input.disabled = true;
    setMessage("Saving delivery day...");
    try {
      const { line } = await api(`/api/driver-lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify({ deliveryDay })
      });
      updateRequestFromLine(currentSheet, line);
      renderCurrentSheet(currentSheet);
      setMessage(deliveryDay ? "Delivery day saved." : "Delivery day cleared.");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      input.disabled = false;
    }
  }

  async function changeSupplier(row, select, currentSheet) {
    const lineId = row.dataset.lineId;
    const itemName = row.querySelector("td:nth-child(3)")?.textContent?.trim() || "this item";
    const choice = await chooseSupplierChangeMode(itemName, select.value || "this supplier");
    if (!choice) {
      renderCurrentSheet(currentSheet);
      setMessage("Supplier change cancelled.");
      return;
    }
    const updatePrimarySupplier = choice === "permanent";
    select.disabled = true;
    setMessage(updatePrimarySupplier ? "Saving supplier and updating primary supplier..." : "Saving temporary supplier...");
    try {
      const { line } = await api(`/api/driver-lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify({ supplierName: select.value, updatePrimarySupplier })
      });
      updateRequestFromLine(currentSheet, line);
      renderCurrentSheet(currentSheet);
      setMessage(updatePrimarySupplier ? "Supplier saved and primary supplier updated." : "Temporary supplier saved for this order.");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      select.disabled = false;
    }
  }

  async function changeUnit(row, select, currentSheet) {
    const lineId = row.dataset.lineId;
    select.disabled = true;
    setMessage("Saving order unit...");
    try {
      const { line } = await api(`/api/driver-lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify({ unit: select.value })
      });
      updateRequestFromLine(currentSheet, line);
      renderCurrentSheet(currentSheet);
      setMessage("Order unit updated for this line.");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      select.disabled = false;
    }
  }

  async function changeQuantity(row, input, currentSheet) {
    const lineId = row.dataset.lineId;
    const quantity = Number(input.value || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setMessage("Quantity must be greater than zero.", true);
      renderCurrentSheet(currentSheet);
      return;
    }
    input.disabled = true;
    setMessage("Saving quantity...");
    try {
      const { line } = await api(`/api/driver-lines/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity })
      });
      updateRequestFromLine(currentSheet, line);
      renderCurrentSheet(currentSheet);
      setMessage("Quantity updated for this line.");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      input.disabled = false;
    }
  }

  return {
    toggleOrdered,
    markDelivered,
    toggleToDeliver,
    changeDeliveryDay,
    changeSupplier,
    changeUnit,
    changeQuantity
  };
}
