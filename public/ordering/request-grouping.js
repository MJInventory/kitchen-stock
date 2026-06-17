export function itemCategory(item) {
  return item?.category || "Uncategorized";
}

export function itemNameFromRequest(request, items = []) {
  return items.find((item) => item.id === request?.itemId)?.name || "Requested item";
}

export function requestSortValue(request, items = []) {
  const item = items.find((candidate) => candidate.id === request?.itemId);
  return {
    supplier: item?.supplierName || request?.supplierName || "",
    category: item?.category || request?.category || "",
    name: item?.name || "Requested item"
  };
}

export function logicalRequestCompare(leftRequest, rightRequest, items = []) {
  const left = requestSortValue(leftRequest, items);
  const right = requestSortValue(rightRequest, items);
  const supplier = left.supplier.localeCompare(right.supplier);
  if (supplier) return supplier;
  const category = left.category.localeCompare(right.category);
  if (category) return category;
  return left.name.localeCompare(right.name);
}

export function groupRequestsByCategory(requests, items = []) {
  const groups = new Map();
  for (const request of requests) {
    const category = items.find((candidate) => candidate.id === request?.itemId)?.category || request?.category || "Uncategorized";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(request);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, categoryRequests]) => ([
      category,
      [...categoryRequests].sort((left, right) => {
        const byName = itemNameFromRequest(left, items).localeCompare(itemNameFromRequest(right, items), undefined, {
          numeric: true,
          sensitivity: "base"
        });
        if (byName) return byName;
        const leftSupplier = requestSortValue(left, items).supplier || "";
        const rightSupplier = requestSortValue(right, items).supplier || "";
        return leftSupplier.localeCompare(rightSupplier, undefined, { sensitivity: "base" });
      })
    ]));
}

export function groupRequestsForOrderSheet(requests, items = []) {
  const groups = new Map();
  for (const request of requests) {
    const sortInfo = requestSortValue(request, items);
    const supplierName = sortInfo.supplier || "Unassigned Supplier";
    const categoryName = sortInfo.category || "Uncategorized";
    if (!groups.has(supplierName)) groups.set(supplierName, new Map());
    const supplierGroups = groups.get(supplierName);
    if (!supplierGroups.has(categoryName)) supplierGroups.set(categoryName, []);
    supplierGroups.get(categoryName).push(request);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([supplierName, categoryGroups]) => ({
      supplierName,
      categories: [...categoryGroups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([categoryName, requestsInCategory]) => ({
          categoryName,
          requests: [...requestsInCategory].sort((left, right) =>
            itemNameFromRequest(left, items).localeCompare(itemNameFromRequest(right, items), undefined, {
              numeric: true,
              sensitivity: "base"
            })
          )
        }))
    }));
}
