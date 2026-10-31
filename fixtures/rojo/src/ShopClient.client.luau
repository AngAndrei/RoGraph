local Purchase = game:GetService("ReplicatedStorage").Shop.Purchase
local ShopClient = {}
function ShopClient.BuySword()
    Purchase:FireServer("Sword")
end
