import { z } from 'zod';
import type { Tool } from './types.js';

const schema = z.object({});

export const listServicesTool: Tool<string[]> = {
  name: 'list_services',
  description:
    'List the distinct service names that have produced logs in the last 24 hours.',
  inputSchema: schema.shape,
  async handler(args, deps) {
    schema.parse(args);
    return deps.logging.listServices();
  },
};
