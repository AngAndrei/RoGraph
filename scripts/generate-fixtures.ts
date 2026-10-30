import { mkdir, writeFile } from "node:fs/promises";
const client = `local RS = game:GetService("ReplicatedStorage")\nlocal Purchase = RS.Shop.Purchase\nlocal ShopClient = {}\nfunction ShopClient.BuySword()\n    Purchase:FireServer("Sword")\nend\n`;
const server = `local Purchase = game:GetService("ReplicatedStorage").Shop.Purchase\nlocal Service = require(script.Parent.PurchaseService)\nlocal function onPurchase(player, itemId)\n    Service.TryPurchase(player, itemId)\nend\nPurchase.OnServerEvent:Connect(onPurchase)\n`;
const service = `local Config = require(game:GetService("ReplicatedStorage").Shop.ShopConfig)\nlocal PurchaseService = {}\nfunction PurchaseService.TryPurchase(player, itemId)\n    local price = Config.Prices.Sword\n    return price > 0\nend\nreturn PurchaseService\n`;
const config = `return { Prices = { Sword = 100, Shield = 150 }, Enabled = true }\n`;
const item = (
  name: string,
  cls: string,
  ref: string,
  children = "",
  src = "",
  extra = "",
) =>
  `<Item class="${cls}" referent="${ref}"><Properties><string name="Name">${name}</string>${src ? `<ProtectedString name="Source"><![CDATA[${src}]]></ProtectedString>` : ""}${extra}</Properties>${children}</Item>`;
const make = (modify: (s: string) => string = (s) => s, extraShop = "") =>
  `<roblox version="4">${item("ReplicatedStorage", "ReplicatedStorage", "rs", item("Shop", "Folder", "shop", item("Purchase", "RemoteEvent", "remote_shop") + item("ShopConfig", "ModuleScript", "config", "", config) + extraShop))}${item("ServerScriptService", "ServerScriptService", "sss", item("ShopServer", "Script", "server", "", server) + item("PurchaseService", "ModuleScript", "service", "", modify(service)))}${item("StarterPlayer", "StarterPlayer", "sp", item("StarterPlayerScripts", "StarterPlayerScripts", "sps", item("ShopClient", "LocalScript", "client", "", client)))}</roblox>`;
await mkdir("fixtures/shop", { recursive: true });
await mkdir("fixtures/adversarial", { recursive: true });
await writeFile("fixtures/shop/place.rbxlx", make());
await writeFile(
  "fixtures/shop/expected.json",
  JSON.stringify(
    {
      requires: [
        ["ShopServer", "PurchaseService"],
        ["PurchaseService", "ShopConfig"],
      ],
      call: ["onPurchase", "TryPurchase"],
      read: "ShopConfig.Prices.Sword",
      initializer: 100,
      remote: "remote_shop",
      trace: [
        "BuySword",
        "Purchase",
        "onPurchase",
        "TryPurchase",
        "Prices.Sword",
      ],
    },
    null,
    2,
  ),
);
await writeFile(
  "fixtures/adversarial/duplicates.rbxlx",
  make((s) => s, item("Purchase", "RemoteEvent", "remote_duplicate")),
);
await writeFile(
  "fixtures/adversarial/dynamic.rbxlx",
  make((s) => s.replace("Config.Prices.Sword", "Config.Prices[itemId]")),
);
await writeFile(
  "fixtures/adversarial/partial.rbxlx",
  make(
    (s) => s,
    item(
      "Broken",
      "ObjectValue",
      "broken",
      "",
      "",
      '<Ref name="Value">missing</Ref><UnknownFutureType name="Future">abc</UnknownFutureType>',
    ),
  ),
);
await writeFile(
  "fixtures/adversarial/unicode.rbxlx",
  `<roblox version="4">${item("Unicode", "ModuleScript", "unicode", "", "-- café 🛒\r\nlocal price = Config.Prices.Sword\r\n")}</roblox>`,
);
await writeFile(
  "fixtures/adversarial/cycles.rbxlx",
  `<roblox version="4">${item("ReplicatedStorage", "ReplicatedStorage", "rs", item("A", "ModuleScript", "a", "", "return require(script.Parent.B)") + item("B", "ModuleScript", "b", "", "return require(script.Parent.A)"))}</roblox>`,
);
await writeFile(
  "fixtures/adversarial/contexts.rbxlx",
  make((s) => s),
);
