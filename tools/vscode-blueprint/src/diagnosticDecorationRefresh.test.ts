import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { expect, it } from 'vitest';

const extensionSource = readFileSync(join(__dirname, 'extension.ts'), 'utf8');

it('refreshes visible decorations after explicit reindex and fileGlob rebuild complete', async () => {
  const reindex = extensionSource.match(/registerCommand\(["']archallyBlueprint\.reindex["'],\s*(async \(\) => \{[\s\S]*?\})\)/)?.[1];
  const configuration = extensionSource.match(/onDidChangeConfiguration\(\(e\) => \{([\s\S]*?)\n\s*\}\)(?:,|\n)/)?.[1];
  expect(reindex).toBeTruthy();
  expect(configuration).toBeTruthy();

  async function run(callbackText: string, event: 'reindex' | 'fileGlob') {
    let finishIndex!: () => void;
    let indexed = false;
    let displayed = false;
    const context = {
      rebuildIndex: () => new Promise<void>(resolve => {
        finishIndex = () => { indexed = true; resolve(); };
      }),
      refreshAllDecorations: () => { displayed = indexed; },
      diagnostics: { refresh: () => {} },
      registerLinkProvider: () => {},
      rebuildDecoType: () => {},
    };
    const callback = event === 'reindex'
      ? vm.runInNewContext(`(${callbackText})`, context) as () => Promise<void>
      : vm.runInNewContext(`(e) => {${callbackText}\n}`, context) as (event: { affectsConfiguration(key: string): boolean }) => void;

    let completion: Promise<void>;
    if (event === 'reindex') completion = (callback as () => Promise<void>)();
    else {
      (callback as (event: { affectsConfiguration(key: string): boolean }) => void)(
        { affectsConfiguration: key => key === 'archallyBlueprint.fileGlob' },
      );
      completion = Promise.resolve();
    }
    expect(displayed).toBe(false);
    finishIndex();
    await completion;
    await Promise.resolve();
    return { indexed, displayed };
  }

  await expect(run(reindex!, 'reindex')).resolves.toEqual({ indexed: true, displayed: true });
  await expect(run(configuration!, 'fileGlob')).resolves.toEqual({ indexed: true, displayed: true });
});
