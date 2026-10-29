// Create web-size copies of large images (cache/media/...webp) for images that don't have one,
// e.g. after uploading files to the bucket by hand. The import does this automatically.
//
//   npm run thumbs [-- --force]

import { adminClient } from './_client.ts';
import { generateThumbs } from './_thumbs.ts';

await generateThumbs(adminClient(), { force: process.argv.includes('--force') });
