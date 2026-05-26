import { describe, it, expect } from 'vitest';
import { extractUI } from './ui.js';
import type { ParsedBlueprintDocument } from '../../model/types.js';
import { ENTITY_TYPE } from '../../model/entityTypes.js';

function makeDoc(data: Record<string, unknown>): ParsedBlueprintDocument {
  return { data, filePath: 'interactions.yaml', scope: 'orders' };
}

describe('extractUI', () => {
  it('extracts screens, actions, and navigation from flat arrays', () => {
    const doc = makeDoc({
      screens: [
        { id: 'SCR001', name: 'Order List', summary: 'Browse orders' },
        { id: 'SCR002', name: 'Order Detail' },
      ],
      actions: [
        { id: 'UAC001', screen: 'SCR002', name: 'Submit Order' },
        { id: 'UAC002', screen: 'SCR001', name: 'View Details' },
        { id: 'UAC003', screen: 'SCR002', name: 'Cancel Order' },
      ],
      navigation: [
        { id: 'UNV001', from: 'SCR001', to: 'SCR002', description: 'List to detail' },
        { id: 'UNV002', from: 'SCR002', to: 'SCR001' },
      ],
    });

    const entities = extractUI(doc);

    // 2 screens + 3 actions + 2 navigation = 7
    expect(entities).toHaveLength(7);

    const screens = entities.filter((e) => e.type === ENTITY_TYPE.Screen);
    expect(screens).toHaveLength(2);
    expect(screens[0]!.displayId).toBe('SCR001');
    expect(screens[0]!.summary).toBe('Browse orders');
    expect(screens[1]!.term).toBe('Order Detail');

    const actions = entities.filter((e) => e.type === ENTITY_TYPE.UIAction);
    expect(actions).toHaveLength(3);
    expect(actions[0]!.displayId).toBe('UAC001');

    const navs = entities.filter((e) => e.type === ENTITY_TYPE.UINavigation);
    expect(navs).toHaveLength(2);
    expect(navs[0]!.displayId).toBe('UNV001');
    expect(navs[0]!.summary).toBe('List to detail');
  });

  it('returns empty array for empty document', () => {
    expect(extractUI(makeDoc({}))).toHaveLength(0);
  });

  it('skips items without id', () => {
    const doc = makeDoc({
      screens: [{ name: 'No ID Screen' }],
      actions: [{ name: 'No ID Action' }],
      navigation: [{ from: 'SCR001', to: 'SCR002' }],
    });
    expect(extractUI(doc)).toHaveLength(0);
  });

  it('sets layer to design.ui', () => {
    const doc = makeDoc({
      screens: [{ id: 'SCR001', name: 'Test' }],
    });
    const entities = extractUI(doc);
    expect(entities[0]!.layer).toBe('design.ui');
  });
});
