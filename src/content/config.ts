import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.union([z.date(), z.string()]),
    summary: z.string().optional(),
    coverImage: z.string().optional(),
    body: z.string().optional(),
  }),
});

const portfolio = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    videoURL: z.string(),
    tags: z.array(z.enum(['Editing','Motion Graphics','VFX','Color','Sound Design'])),
    thumbnail: z.string().optional(),
    description: z.string().optional(),
  }),
});

const home = defineCollection({
  type: 'data',
  schema: z.object({
    headline: z.string(),
    subline: z.string().optional(),
    intro: z.string().optional(),
    ctaPrimaryLabel: z.string().optional(),
    ctaPrimaryUrl: z.string().optional(),
    ctaSecondaryLabel: z.string().optional(),
    ctaSecondaryUrl: z.string().optional(),
    heroImage: z.string().optional(),
  }),
});

const skills = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    pov: z.string(),
    highlights: z.array(z.object({
      item: z.string()
    }))
  }),
});

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    body: z.string().optional(),
    headshot: z.string().optional(),
  }),
});

export const collections = { blog, portfolio, home, skills, pages };
