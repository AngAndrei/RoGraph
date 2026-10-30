local Purchase = game:GetService("ReplicatedStorage").Shop.Purchase
local Service = require(script.Parent.PurchaseService)
local function onPurchase(player, itemId)
    Service.TryPurchase(player, itemId)
end
Purchase.OnServerEvent:Connect(onPurchase)
