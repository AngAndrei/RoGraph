// @vitest-environment jsdom
import {it,expect} from 'vitest';import {render,screen,cleanup} from '@testing-library/react';import {ImportView} from '../../apps/web/src/ImportView.js';
it('offers accessible saved-place and Rojo import controls',()=>{try{render(<ImportView onJob={()=>{}} onClose={()=>{}}/>);expect(screen.getByLabelText('Place file')).toBeTruthy();expect(screen.getByRole('button',{name:'Analyze'})).toBeTruthy();expect(screen.getByRole('button',{name:'Rojo project'})).toBeTruthy();}finally{cleanup();}});
