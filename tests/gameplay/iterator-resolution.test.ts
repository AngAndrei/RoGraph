import { expect, it } from "vitest";
import { gameplayGraph } from "./graph.js";

const storage = 'local storage = game:GetService("ServerStorage")';

it.each([
  "{storage.Egg, storage.ChickenItem}",
  "pairs({egg = storage.Egg, tool = storage.ChickenItem})",
  "ipairs({storage.Egg, storage.ChickenItem})",
])(
  "retains every possible object from the inline table iterator %s",
  async (iterator) => {
    const graph = await gameplayGraph({
      GameServer: `${storage}\nfor _, item in ${iterator} do item:Destroy() end`,
    });
    const effects = graph.relations.filter(
      (relation) => relation.type === "DESTROYS",
    );
    expect(effects.map((effect) => effect.target).sort()).toEqual([
      "chickentool",
      "egg",
    ]);
    for (const effect of effects)
      expect(
        graph.evidence.find((evidence) => evidence.relationId === effect.id)
          ?.status,
      ).toBe("candidate");
  },
);

it("does not bind an extra loop variable to the second iterator result", async () => {
  const graph = await gameplayGraph({
    GameServer: `${storage}\nfor _, item, extra in ipairs(storage.Egg:GetChildren()) do item:Destroy(); extra:Destroy() end`,
  });
  const effects = graph.relations.filter(
    (relation) => relation.type === "DESTROYS",
  );
  expect(effects.map((effect) => effect.target)).toEqual(["eggpart"]);
  expect(
    graph.sites.some((site) => site.reason === "UNMODELED_ITERATOR_SLOT"),
  ).toBe(true);
});

it("stops ipairs before a known gap and leaves a shadowed iterator unmodeled", async () => {
  const graph = await gameplayGraph({
    GameServer: `${storage}\nfor _, item in ipairs({storage.Egg, nil, storage.ChickenItem}) do item:Destroy() end\nlocal function pairs(_) return customIterator end\nfor _, item in pairs({storage.ChickenItem}) do item:Destroy() end`,
  });
  const effects = graph.relations.filter(
    (relation) => relation.type === "DESTROYS",
  );
  expect(effects.map((effect) => effect.target)).toEqual(["egg"]);
});

it.each([
  "{[runtimeKey] = storage.Egg, tool = storage.ChickenItem}",
  "{[1] = storage.Egg, storage.ChickenItem}",
  "{storage.Egg, getMoreObjects()}",
])(
  "does not infer effects from a table with an uncertain shape %s",
  async (iterator) => {
    const graph = await gameplayGraph({
      GameServer: `${storage}\nfor _, item in ${iterator} do item:Destroy() end`,
    });
    expect(
      graph.relations.some((relation) => relation.type === "DESTROYS"),
    ).toBe(false);
    expect(
      graph.sites.some((site) => site.reason === "UNMODELED_ITERATOR"),
    ).toBe(true);
  },
);
