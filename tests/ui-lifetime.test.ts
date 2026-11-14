import {it,expect,vi,afterEach} from 'vitest';
import {createUiLifetime} from '../apps/local/src/ui-lifetime.js';
afterEach(()=>vi.useRealTimers());
it('stops after the last tab closes while allowing reload and other tabs',()=>{
 vi.useFakeTimers();const stop=vi.fn(), lease=createUiLifetime(stop);
 lease.update('first',true);lease.update('second',true);lease.update('first',false);
 vi.advanceTimersByTime(3000);expect(stop).not.toHaveBeenCalled();
 lease.update('second',false);vi.advanceTimersByTime(1000);lease.update('reload',true);
 vi.advanceTimersByTime(3000);expect(stop).not.toHaveBeenCalled();
 lease.update('reload',false);vi.advanceTimersByTime(2500);expect(stop).toHaveBeenCalledTimes(1);lease.dispose();
});
it('expires a crashed tab without changing services that never opened a UI',()=>{
 vi.useFakeTimers();const stop=vi.fn(),lease=createUiLifetime(stop);vi.advanceTimersByTime(180000);expect(stop).not.toHaveBeenCalled();lease.update('tab',true);vi.advanceTimersByTime(120000);expect(stop).toHaveBeenCalledOnce();lease.dispose();
});
