import {test,expect} from './support.js';
import {fixturePath} from '../support/fixtures.js';
test('simplifies the shell and remembers a functional dark theme',async({page,app})=>{
 await page.goto(app.url+'/#session='+app.sessionToken);
 const theme=page.getByRole('switch',{name:'Dark mode'});
 await expect(theme).toBeVisible();await theme.click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.reload();await expect(theme).toHaveAttribute('aria-checked','true');
 await page.getByLabel('Place file').setInputFiles(fixturePath('gameplay/egg-flow.rbxlx'));
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.locator('.sigma-container')).toHaveAttribute('data-layout-ready','true',{timeout:90000});
 await expect(page.locator('.breadcrumb,.offline,.map-scope,.game-orientation,.snapshot-diff')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Stop app',exact:true})).toHaveCount(0);
 await page.screenshot({path:'build/previews/appearance-dark.png'});
 await theme.click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.screenshot({path:'build/previews/appearance-light.png'});
});
test('closes the local service when its last browser tab closes',async({page,app})=>{
 await page.goto(app.url+'/#session='+app.sessionToken);
 await expect(page.getByRole('switch',{name:'Dark mode'})).toBeVisible();
 await page.close();
 await expect.poll(async()=>{try{await fetch(app.url);return false;}catch{return true;}},{timeout:10000}).toBe(true);
});
