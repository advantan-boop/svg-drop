// AI-подбор объектов по метафоре. Работает на стороне сервера (dev/preview Vite),
// ключ не попадает в браузер. AI выбирает только из существующего каталога —
// новых объектов не генерирует.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import type { Connect } from 'vite';

const MODEL = 'claude-opus-5-5';

interface CatalogItem { id: string; name: string; tags: string[] }

function catalog(root: string): { objects: CatalogItem[]; palettes: { id: string; name: string }[] } {
  const idx = JSON.parse(fs.readFileSync(path.join(root, 'public/library/index.json'), 'utf8'));
  return {
    objects: idx.objects.map((o: CatalogItem) => ({ id: o.id, name: o.name, tags: o.tags.filter((t: string) => /[а-я]/i.test(t)).slice(0, 10) })),
    palettes: idx.palettes.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })),
  };
}

let client: Anthropic | null = null;
let disabledReason = '';

export function aiMiddleware(root: string): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next();
    const send = (code: number, body: unknown) => {
      res.statusCode = code;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };

    if (req.url === '/api/status') {
      const hasCreds = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
      return send(200, { ai: hasCreds && !disabledReason, model: MODEL, reason: disabledReason || (hasCreds ? '' : 'нет ANTHROPIC_API_KEY') });
    }

    if (req.url === '/api/pick' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const { text, extra } = JSON.parse(raw || '{}') as { text?: string; extra?: CatalogItem[] };
      if (!text?.trim()) return send(400, { error: 'empty' });

      const cat = catalog(root);
      const objects = [...cat.objects, ...(extra ?? []).map((e) => ({ id: e.id, name: e.name, tags: e.tags.slice(0, 10) }))];
      const ids = objects.map((o) => o.id);
      try {
        client ??= new Anthropic();
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: 4000,
          output_config: {
            effort: 'low',
            format: {
              type: 'json_schema',
              schema: {
                type: 'object',
                properties: {
                  objects: { type: 'array', items: { type: 'string', enum: ids }, description: '3–5 id в порядке важности' },
                  palette: { type: 'string', enum: cat.palettes.map((p) => p.id) },
                  layout: { type: 'string', enum: ['assembled', 'offset', 'headline'] },
                  reason: { type: 'string', description: 'одно предложение по-русски: почему эти предметы передают метафору' },
                },
                required: ['objects', 'palette', 'layout', 'reason'],
                additionalProperties: false,
              },
            },
          },
          system:
            'Ты арт-директор. По заголовку или метафоре выбери из каталога 3–5 предметов, которые вместе визуально передают смысл. ' +
            'Выбирать можно только из каталога, придумывать новые предметы нельзя. Первый — главный. ' +
            'Палитра: palette-1 «Лаванда» — спокойная, palette-2 «Персик» — тёплая, palette-3 «Мята» — свежая. ' +
            'Раскладка: assembled — сцена по центру, offset — сцена у края, headline — оставить место под заголовок.',
          messages: [{ role: 'user', content: `Каталог:\n${JSON.stringify(objects)}\n\nЗапрос: ${text.slice(0, 500)}` }],
        });
        if (msg.stop_reason === 'refusal') return send(422, { error: 'refusal' });
        const block = msg.content.find((b) => b.type === 'text');
        const out = JSON.parse(block && block.type === 'text' ? block.text : '{}');
        out.objects = [...new Set((out.objects as string[]).filter((id) => ids.includes(id)))].slice(0, 5);
        return send(200, { ...out, model: MODEL });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) disabledReason = 'ключ API не принят';
        const status = e instanceof Anthropic.APIError ? e.status : 0;
        return send(503, { error: e instanceof Error ? e.message : 'ai error', status });
      }
    }
    next();
  };
}
