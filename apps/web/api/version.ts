import buildInfo from '../build-info.json' with { type: 'json' };

export default function handler(_req: unknown, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(buildInfo);
}
