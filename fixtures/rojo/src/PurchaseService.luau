local Config = require(game:GetService("ReplicatedStorage").Shop.ShopConfig)
local PurchaseService = {}
function PurchaseService.TryPurchase(player, itemId)
    local price = Config.Prices.Sword
    return price > 0
end
return PurchaseService
