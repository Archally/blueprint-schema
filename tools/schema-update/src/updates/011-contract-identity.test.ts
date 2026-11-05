import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  update,
  contractNameOf,
  splitOutput,
  rewriteContractOutputs,
  rewriteTestCaseContractFiles,
  declaredSliceNames,
} from './011-contract-identity.js';

/**
 * The split, with the values that must NOT move first.
 *
 * The transform rewrites a key called `output`, and `output` is a common word: it appears on
 * resources, on generators, in prose. The fixture therefore leads with every `output:` in an arch
 * file that is not a contract's own, because rewriting one of those is the failure mode with no
 * visible symptom - a valid file that now says something else.
 */
const SLICES = new Set(['orders', 'catalog']);

const ARCH = `name: Test Architecture
contexts:
  - id: orders
    name: Orders
    kind: core
    services:
      - id: SVC001
        name: OrderService
        properties:
          # not a contract's key, and not at a contract's depth
          output: "some/prose/value.txt"
        contracts:
          openapi:
            output: "orders/orders-api.openapi.yaml"
            expose: [orders.CMD001]
          asyncapi:
            output: "_global/shared-events.asyncapi.yaml"
            send: [orders.EVT001]
          openrpc:
            output: dist/orders-rpc.openrpc.json
            expose: [orders.CMD002]
          arazzo:
            output: 'checkout.arazzo.yaml'
            workflows: [checkout]
`;

describe('contractNameOf', () => {
  it('takes the basename up to its first dot, whatever the extension chain looks like', () => {
    expect(contractNameOf('orders/orders-api.openapi.yaml')).toBe('orders-api');
    expect(contractNameOf('orders-api.openapi.yaml')).toBe('orders-api');
    expect(contractNameOf('dist/sub/orders-rpc.openrpc.json')).toBe('orders-rpc');
    // Non-canonical suffixes exist in the corpus and reduce the same way.
    expect(contractNameOf('feedback/feedback-api.async.yaml')).toBe('feedback-api');
    expect(contractNameOf('admin-api-client.http')).toBe('admin-api-client');
    expect(contractNameOf('orders-api')).toBe('orders-api');
  });
});

describe('splitOutput - what each prefix means', () => {
  it('a bare value becomes a name, placed by the declaring file', () => {
    expect(splitOutput('orders-api.openapi.yaml', '  ', SLICES).lines)
      .toEqual(['  contract_name: orders-api']);
  });

  it('a declared slice becomes `slice:`', () => {
    expect(splitOutput('orders/orders-api.openapi.yaml', '  ', SLICES).lines)
      .toEqual(['  contract_name: orders-api', '  slice: orders']);
  });

  it('`_global/` becomes `cross_cutting: true`, not a slice literally called _global', () => {
    expect(splitOutput('_global/shared.openapi.yaml', '  ', SLICES).lines)
      .toEqual(['  contract_name: shared', '  cross_cutting: true']);
  });

  it('a build folder is DROPPED and reported, because a statement is being deleted', () => {
    const result = splitOutput('dist/orders-api.openapi.yaml', '  ', SLICES);
    expect(result.lines).toEqual(['  contract_name: orders-api']);
    expect(result.dropped).toMatch(/dist/);
  });

  it('a prefix that is neither refuses, and refuses rather than guessing', () => {
    const result = splitOutput('ordrs/orders-api.openapi.yaml', '  ', SLICES);
    expect(result.lines).toEqual([]);
    expect(result.refused).toMatch(/ordrs/);
  });

  it('a value that yields no usable name refuses', () => {
    // A value that is only an extension leaves nothing to name the document with.
    expect(splitOutput('.openapi.yaml', '  ', SLICES).refused).toBeTruthy();
  });

  it('the replacement sits at the indent it was handed, not at a fixed one', () => {
    expect(splitOutput('orders/x.openapi.yaml', '        ', SLICES).lines[1]).toBe('        slice: orders');
  });
});

describe('rewriteContractOutputs', () => {
  it('rewrites the four contract outputs and leaves the fifth `output:` alone', () => {
    const result = rewriteContractOutputs(ARCH, SLICES);
    expect(result.split).toBe(4);
    // The one that is not a contract's key survives byte for byte.
    expect(result.text).toContain('output: "some/prose/value.txt"');
    expect(result.text).toContain('contract_name: orders-api\n            slice: orders');
    expect(result.text).toContain('contract_name: shared-events\n            cross_cutting: true');
    // The build-folder prefix is gone and named.
    expect(result.text).toContain('contract_name: orders-rpc');
    expect(result.drops).toHaveLength(1);
    expect(result.text).toContain('contract_name: checkout');
  });

  it('is idempotent - a second run finds nothing to do', () => {
    const once = rewriteContractOutputs(ARCH, SLICES);
    const twice = rewriteContractOutputs(once.text, SLICES);
    expect(twice.split).toBe(0);
    expect(twice.text).toBe(once.text);
  });

  it('preserves CRLF line endings', () => {
    const result = rewriteContractOutputs(ARCH.replace(/\n/g, '\r\n'), SLICES);
    expect(result.text.includes('\r\n')).toBe(true);
    expect(result.text.includes('\n\n')).toBe(false);
  });

  it('preserves the sibling keys and the comment that sat beside the rewritten line', () => {
    const result = rewriteContractOutputs(ARCH, SLICES);
    expect(result.text).toContain('# not a contract’s key, and not at a contract’s depth'.replace(/’/g, "'"));
    expect(result.text).toContain('expose: [orders.CMD001]');
    expect(result.text).toContain('workflows: [checkout]');
  });

  it('refuses a prefix it does not recognise and leaves that declaration exactly as it was', () => {
    const arch = ARCH.replace('orders/orders-api.openapi.yaml', 'ordrs/orders-api.openapi.yaml');
    const result = rewriteContractOutputs(arch, SLICES);
    expect(result.split).toBe(3);
    expect(result.text).toContain('output: "ordrs/orders-api.openapi.yaml"');
    expect(result.refusals).toHaveLength(1);
  });
});

describe('rewriteTestCaseContractFiles', () => {
  const TEST_CASES = `happy_path:
  - id: TC001
    name: Places an order
    contract:
      file: "dist/orders-api.openapi.yaml"
      operation: createOrder
  - id: TC002
    name: Reads a file
    inputs:
      file: "not-a-contract.yaml"
`;

  it('renames a contract file to the contract’s name, and only under `contract:`', () => {
    const result = rewriteTestCaseContractFiles(TEST_CASES);
    expect(result.rewritten).toBe(1);
    expect(result.text).toContain('file: orders-api');
    // `inputs.file` is a different key with the same name; it must not move.
    expect(result.text).toContain('file: "not-a-contract.yaml"');
  });

  it('is idempotent', () => {
    const once = rewriteTestCaseContractFiles(TEST_CASES);
    expect(rewriteTestCaseContractFiles(once.text).rewritten).toBe(0);
  });
});

describe('declaredSliceNames + the update end to end', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-011-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const writeModel = () => {
    fs.writeFileSync(path.join(dir, 'blueprint.yaml'), `name: Test
version: "1.0.0"
layout:
  slices:
    - name: orders
      description: Ordering
    - name: catalog
      description: Catalogue
`);
    fs.mkdirSync(path.join(dir, 'orders'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'orders', 'arch.yaml'), ARCH);
  };

  it('reads the DECLARED slice list, not the directories on disk', () => {
    writeModel();
    expect([...declaredSliceNames(dir)].sort()).toEqual(['catalog', 'orders']);
  });

  it('plans before it writes, and the plan names the file and the count', () => {
    writeModel();
    const plan = update.plan(dir);
    expect(plan.changes.some(change => change.detail.includes('4 contract output(s)'))).toBe(true);
    // A plan writes nothing.
    expect(fs.readFileSync(path.join(dir, 'orders', 'arch.yaml'), 'utf8')).toContain('output:');
  });

  it('applies, and applying twice changes nothing the second time', () => {
    writeModel();
    const first = update.apply(dir);
    expect(first.applied).toBe(true);
    const after = fs.readFileSync(path.join(dir, 'orders', 'arch.yaml'), 'utf8');
    expect(after).toContain('contract_name: orders-api');
    const second = update.apply(dir);
    expect(second.changes.filter(c => c.detail.includes('contract output'))).toHaveLength(0);
    expect(fs.readFileSync(path.join(dir, 'orders', 'arch.yaml'), 'utf8')).toBe(after);
  });
});
