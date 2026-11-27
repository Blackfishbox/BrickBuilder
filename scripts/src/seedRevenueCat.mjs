import { ReplitConnectors } from "@replit/connectors-sdk";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Run manually: pnpm --filter @workspace/scripts exec node src/seedRevenueCat.mjs
// This configures RevenueCat, not Google Play prices or service-account access.
const connectors = new ReplitConnectors();
async function request(path, body) {
  const response = await connectors.proxy("revenuecat", `/v2${path}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { method: "GET" });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.message ?? data.type}`);
  return data;
}
async function all(path) {
  const items = [];
  let next = `/v2${path}`;
  while (next) {
    const response = await connectors.proxy("revenuecat", next);
    const data = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${data.message ?? data.type}`);
    items.push(...data.items);
    next = data.next_page;
  }
  return items;
}
const project = (await all("/projects?limit=100")).find(p => p.name === "BrickBuilder")
  ?? await request("/projects", { name: "BrickBuilder" });
const base = `/projects/${project.id}`;
const apps = await all(`${base}/apps?limit=100`);
const app = apps.find(a => a.type === "play_store" && a.play_store?.package_name === "brickbuilder.blackfishbox.de")
  ?? await request(`${base}/apps`, {
    name: "BrickBuilder Android", type: "play_store",
    play_store: { package_name: "brickbuilder.blackfishbox.de" },
  });
const product = (await all(`${base}/products?limit=100`)).find(p =>
  p.app_id === app.id && p.store_identifier === "brickbuilder_premium")
  ?? await request(`${base}/products`, {
    app_id: app.id, store_identifier: "brickbuilder_premium",
    type: "non_consumable", display_name: "BrickBuilder Premium",
  });
const entitlement = (await all(`${base}/entitlements?limit=100`)).find(e => e.lookup_key === "brickbuilder_premium")
  ?? await request(`${base}/entitlements`, { lookup_key: "brickbuilder_premium", display_name: "BrickBuilder Premium" });
if (!(await all(`${base}/entitlements/${entitlement.id}/products`)).some(p => p.id === product.id)) {
  await request(`${base}/entitlements/${entitlement.id}/actions/attach_products`, { product_ids: [product.id] });
}
const offerings = await all(`${base}/offerings?limit=100`);
const offering = offerings.find(o => o.is_current)
  ?? await request(`${base}/offerings`, { lookup_key: "default", display_name: "BrickBuilder Premium" });
if (!offering.is_current) await request(`${base}/offerings/${offering.id}`, { is_current: true });
const pkg = (await all(`${base}/offerings/${offering.id}/packages`)).find(p => p.lookup_key === "$rc_lifetime")
  ?? await request(`${base}/offerings/${offering.id}/packages`, { lookup_key: "$rc_lifetime", display_name: "Premium lifetime" });
if (!(await all(`${base}/packages/${pkg.id}/products`)).some(p => p.id === product.id)) {
  await request(`${base}/packages/${pkg.id}/actions/attach_products`, {
    products: [{ product_id: product.id, eligibility_criteria: "all" }],
  });
}
const keys = await all(`${base}/apps/${app.id}/public_api_keys`);
const key = keys.find(k => k.key.startsWith("goog_"))?.key;
if (!key) throw new Error("No Google Play public SDK key was returned.");
const output = new URL("../../artifacts/brickbuilder-mobile/src/features/premium/revenuecat-config.json", import.meta.url);
await mkdir(fileURLToPath(new URL(".", output)), { recursive: true });
await writeFile(output, JSON.stringify({
  androidPublicApiKey: key, entitlement: entitlement.lookup_key, product: product.store_identifier,
}, null, 2) + "\n");
console.log("RevenueCat Android lifetime product configured. Public SDK configuration saved.");
console.log("Google Play still requires an active one-time product and RevenueCat service-account authorization.");
