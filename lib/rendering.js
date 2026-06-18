import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import ejs from "ejs";

export function createRenderer({
  publicDir,
  viewsDir,
  appVersion,
  assetWithVersion,
  mimeTypes,
  send
}) {
  async function serveStatic(req, res) {
    const url = new URL(req.url, "http://localhost");
    const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = normalize(join(publicDir, rawPath));

    if (!filePath.startsWith(publicDir)) {
      send(res, 403, "Forbidden", "text/plain; charset=utf-8");
      return;
    }

    try {
      const file = await readFile(filePath);
      send(res, 200, file, mimeTypes[extname(filePath)] || "application/octet-stream");
    } catch {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
    }
  }

  async function renderView(res, viewName, data = {}, status = 200) {
    const viewData = {
      appVersion,
      bodyClass: "",
      pageTitle: "MJ Stock Magic",
      pageEyebrow: "Inventory",
      brandTitle: "MJ Stock Magic",
      brandSubtitle: "MADAME JANETTE",
      themeColor: "#0f766e",
      assetWithVersion,
      headExtras: "",
      contentClass: "shell setup-shell",
      beforeMain: "",
      topbarMenus: true,
      showPageIntro: false,
      topbarClass: "",
      topbarActions: "",
      footerScripts: [],
      ...data
    };
    const body = await ejs.renderFile(join(viewsDir, `${viewName}.ejs`), viewData, { views: [viewsDir] });
    const html = await ejs.renderFile(
      join(viewsDir, "layouts", "base.ejs"),
      {
        ...viewData,
        body
      },
      { views: [viewsDir] }
    );
    send(res, status, html, "text/html; charset=utf-8");
  }

  return {
    renderView,
    serveStatic
  };
}
