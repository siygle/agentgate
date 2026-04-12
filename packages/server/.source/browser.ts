// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"agent-skills.mdx": () => import("../content/docs/agent-skills.mdx?collection=docs"), "api-diff.mdx": () => import("../content/docs/api-diff.mdx?collection=docs"), "index.mdx": () => import("../content/docs/index.mdx?collection=docs"), }),
};
export default browserCollections;