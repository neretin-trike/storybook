/* eslint-disable global-require, import/no-dynamic-require */
import findUp from 'find-up';
import { dirname } from 'path';
import type { SupportedFrameworks, SupportedRenderers } from './project_types';
import { externalFrameworks } from './project_types';

export function getCliDir() {
  return dirname(require.resolve('@storybook/cli/package.json'));
}

const pnpAPICache: Record<string, any> = {};
const pnpFileCache: Record<string, any> = {};

const resolveUsingPnpAPI = (request: string, cwd: string) => {
  pnpFileCache[cwd] = pnpFileCache[cwd] || findUp.sync('.pnp.cjs', { cwd, type: 'file' });
  const pnpFile = pnpFileCache[cwd];
  if (pnpFile) {
    if (!pnpAPICache[pnpFile]) {
      pnpAPICache[pnpFile] = require(pnpFile);
      pnpAPICache[pnpFile].setup();
    }
    const pnpPath = pnpAPICache[pnpFile].resolveRequest(request, cwd);
    if (pnpPath) {
      return pnpPath;
    }
  }
  return undefined;
};

export function getRendererDir(renderer: SupportedFrameworks | SupportedRenderers) {
  const externalFramework = externalFrameworks.find((framework) => framework.name === renderer);
  const frameworkPackageName =
    externalFramework?.renderer || externalFramework?.packageName || `@storybook/${renderer}`;

  const packageJsonPath = `${frameworkPackageName}/package.json`;
  let resolved = null;

  try {
    resolved = require.resolve(packageJsonPath, {
      paths: [process.cwd()],
    });
  } catch (e) {
    //
  }

  if (!resolved) {
    try {
      resolved = resolveUsingPnpAPI(packageJsonPath, process.cwd());
    } catch (e) {
      //
    }
  }

  if (resolved) {
    return dirname(resolved);
  }

  throw new Error(`Cannot find ${packageJsonPath}`);
}
