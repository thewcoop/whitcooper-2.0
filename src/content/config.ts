
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.string(),
    coverImage: z.string().optional(),
    summary: z.string().optional()
  })
});

const portfolio = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    videoURL: z.string(),
    tags: z.array(z.enum(['Editing','Motion Graphics','VFX','Color','Sound Design'])),
    thumbnail: z.string().optional(),
    description: z.string().optional()
  })
});

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    headshot: z.string().optional()
  })
});

export const collections = { blog, portfolio, pages };
