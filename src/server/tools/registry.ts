/**
 * KendaliAI Tool Registry
 */

export interface Tool {
  name: string;
  description: string;
  parameters: any;
  handler: (params: any) => Promise<any>;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  async execute(name: string, params: any) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return await tool.handler(params);
  }

  list() {
    return Array.from(this.tools.values());
  }
}

export const toolRegistry = new ToolRegistry();

export default toolRegistry;
