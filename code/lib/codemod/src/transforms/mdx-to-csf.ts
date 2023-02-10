/* eslint-disable no-param-reassign */
import type { API, FileInfo } from 'jscodeshift';
import { babelParse } from '@storybook/csf-tools';
import { remark } from 'remark';
import remarkMdx from 'remark-mdx';
import visit from 'unist-util-visit';
import { is } from 'unist-util-is';
import type { MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { MdxjsEsm } from 'mdast-util-mdxjs-esm';
import * as t from '@babel/types';
import { BabelFile } from '@babel/core';
import * as babel from '@babel/core';
import * as recast from 'recast';
import * as path from 'node:path';
import { dedent } from 'ts-dedent';
import { capitalize } from 'lodash';

export default function (info: FileInfo, api: API, options: { parser?: string }) {
  const fileName = path.basename(info.path);
  const [root] = transform(info.source, fileName);

  console.log(root);

  return root;

  // TODO what do I need to with the title?
  // const fileNode = loadCsf(info.source, { makeTitle: (title) => title })._ast;
  // // @ts-expect-error File is not yet exposed, see https://github.com/babel/babel/issues/11350#issuecomment-644118606
  // const file: BabelFile = new babel.File(
  //   { filename: info.path },
  //   { code: info.source, ast: fileNode }
  // );

  // let output = recast.print(file.path.node).code;

  // try {
  //   const prettierConfig = prettier.resolveConfig.sync('.', { editorconfig: true }) || {
  //     printWidth: 100,
  //     tabWidth: 2,
  //     bracketSpacing: true,
  //     trailingComma: 'es5',
  //     singleQuote: true,
  //   };
  //
  //   output = prettier.format(output, { ...prettierConfig, filepath: info.path });
  // } catch (e) {
  //   console.log(`Failed applying prettier to ${info.path}.`);
  // }
  //
  // return output;
}

export function transform(
  source: string,
  filename: string
): [mdx: string, csf: string, newFileName: string] {
  const root = remark().use(remarkMdx).parse(source);

  // rewrite imports
  const esm: string[] = [];
  visit(root, ['mdxjsEsm'], (node: MdxjsEsm) => {
    node.value = node.value.replace('@storybook/addon-docs', '@storybook/blocks');

    esm.push(node.value);
  });
  const esmSource = esm.join('\n');

  const ast: t.File = babelParse(esmSource);
  // @ts-expect-error File is not yet exposed, see https://github.com/babel/babel/issues/11350#issuecomment-644118606
  const file: BabelFile = new babel.File({ filename: 'info.path' }, { code: esmSource, ast });

  let meta: MdxJsxFlowElement | MdxJsxTextElement;
  const stories: (MdxJsxFlowElement | MdxJsxTextElement)[] = [];

  const baseName = filename
    .replace('.stories.mdx', '')
    .replace('story.mdx', '')
    .replace('.mdx', '');

  let found = false;

  visit(root, ['mdxjsEsm'], (node: MdxjsEsm) => {
    if (!found) {
      node.value += '\n';
      node.value += dedent`
        import * as ${baseName}Stories from './${baseName}.stories';
      `;
      found = true;
    }
  });

  const metaAttributes = [];

  const storiesMap = new Map<string, { attributes: unknown; children: unknown[] }>();

  visit(
    root,
    ['mdxJsxFlowElement', 'mdxJsxTextElement'],
    (node: MdxJsxFlowElement | MdxJsxTextElement, index, parent) => {
      if (is(node, { name: 'Meta' })) {
        metaAttributes.push(...node.attributes);
        node.attributes = [
          {
            type: 'mdxJsxAttribute',
            name: 'of',
            value: {
              type: 'mdxJsxAttributeValueExpression',
              value: `${baseName}Stories`,
            },
          },
        ];
        meta = node;
      }
      if (is(node, { name: 'Story' })) {
        const found = node.attributes.find((it) => {
          if (it.type === 'mdxJsxAttribute') {
            return it.name === 'name';
          }
        });

        if (typeof found?.value === 'string') {
          const name = capitalize(found.value);
          storiesMap.set(name, { attributes: node.attributes, children: node.children });
          node.attributes = [
            {
              type: 'mdxJsxAttribute',
              name: 'of',
              value: {
                type: 'mdxJsxAttributeValueExpression',
                value: `${baseName}Stories.${name}`,
              },
            },
          ];

          node.children = [];
        } else {
          parent.children.splice(index, 1);
          // FIXME: stop traversing
        }
        stories.push(node);
      }
    }
  );

  // rewrite exports to normal variables

  file.path.traverse({
    ExportNamedDeclaration(path) {
      path.replaceWith(path.node.declaration);
    },
  });

  file.path.traverse({
    Program(path) {
      const body = path.get('body');
      const last = body[body.length - 1];

      last.insertAfter(t.exportDefaultDeclaration(t.objectExpression([])));
      // body.push();
      // path.get('body').push();
    },
  });

  console.log(metaAttributes, storiesMap);

  const newMdx = remark().use(remarkMdx).stringify(root) as unknown as string;
  const output = recast.print(file.path.node).code;
  const newFileName = `${baseName}.stories.tsx`;
  return [newMdx, output, newFileName];
}
