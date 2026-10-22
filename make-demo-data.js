'use strict';
/**
 * make-demo-data.js — membuat dataset contoh untuk screenshot README.
 * Dipakai juga sebagai contoh struktur data/db.json.
 *
 *   node make-demo-data.js [folder-tujuan]
 */

const fs = require('fs');
const path = require('path');

const target = process.argv[2] || path.join(__dirname, 'data-demo');
fs.mkdirSync(target, { recursive: true });

const now = new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const demo = {
  items: [
    {
      id: 'demo-1',
      title: 'Naruto',
      type: 'manga',
      url: 'https://komiku.org/manga/naruto/',
      cover: 'https://thumbnail.komiku.to/uploads/manga/naruto/manga_thumbnail-Manga-Naruto.jpg?w=1200',
      note: 'Lanjut dari chapter 700',
      source: 'komiku.org',
      hiatus: false,
      read: false,
      readChapter: 'Chapter 699',
      readChapterNum: 699,
      latestChapter: { title: 'Chapter 701', url: 'https://komiku.org/naruto-chapter-701/', num: 701, date: daysAgo(2) },
      nextChapter: { title: 'Chapter 700', url: 'https://komiku.org/naruto-chapter-700/', num: 700, date: daysAgo(9) },
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'demo-2',
      title: 'Bleach',
      type: 'manga',
      url: 'https://komiku.org/manga/bleach/',
      cover: 'https://thumbnail.komiku.to/uploads/manga/bleach/manga_thumbnail-Manga-Bleach.jpg?w=1200',
      note: 'Tunggu chapter baru tiap minggu',
      source: 'komiku.org',
      hiatus: false,
      read: false,
      readChapter: '',
      readChapterNum: -1,
      latestChapter: { title: 'Chapter 686', url: 'https://komiku.org/bleach-chapter-686/', num: 686, date: daysAgo(1) },
      nextChapter: { title: 'Chapter 686', url: 'https://komiku.org/bleach-chapter-686/', num: 686, date: daysAgo(1) },
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'demo-3',
      title: 'I Became a Hatchling',
      type: 'manga',
      url: 'https://komiku.org/manga/i-became-a-hatchling/',
      cover: 'https://thumbnail.komiku.to/new/img/images/2026/05/05/20260505120018_57a501099e5c89a5_c03461f5.webp?w=1200',
      note: 'Pantau mingguan',
      source: 'komiku.org',
      hiatus: false,
      read: true,
      readChapter: 'Chapter 29',
      readChapterNum: 29,
      latestChapter: { title: 'Chapter 30', url: 'https://komiku.org/i-became-a-hatchling-chapter-30/', num: 30, date: daysAgo(3) },
      nextChapter: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'demo-4',
      title: 'Healing at the Academy Convenience Store',
      type: 'manga',
      url: 'https://komiku.org/manga/healing-at-the-academy-convenience-store/',
      cover: 'https://thumbnail.komiku.to/new/img/images/2026/08/25/20260825011508_736876672b7b896f_96900858.webp?w=1200',
      note: 'Lagi santai',
      source: 'komiku.org',
      hiatus: false,
      read: true,
      readChapter: 'Chapter 20',
      readChapterNum: 20,
      latestChapter: { title: 'Chapter 20', url: 'https://komiku.org/healing-at-the-academy-convenience-store-chapter-20/', num: 20, date: daysAgo(1) },
      nextChapter: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'demo-5',
      title: 'Playlist Opening Anime',
      type: 'youtube',
      url: 'https://www.youtube.com/playlist?list=PLc1vyOIGc2qWN2TGVP8UJukobWE2BU0qh',
      cover: '',
      note: 'Playlist YouTube',
      source: 'youtube.com',
      hiatus: false,
      read: false,
      readChapter: '',
      readChapterNum: -1,
      latestVideo: { id: 'aGwpalkTIQE', title: 'Opening Season 3 — The New Era', index: 16, url: 'https://www.youtube.com/watch?v=aGwpalkTIQE' },
      lastVideoIndex: 12,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'demo-6',
      title: 'Kaguya-sama',
      type: 'manga',
      url: 'https://komiku.org/manga/kaguya-sama/',
      cover: '',
      note: ' hiatus, nunggu rilisan lanjut',
      source: 'komiku.org',
      hiatus: true,
      read: true,
      readChapter: 'Chapter 210',
      readChapterNum: 210,
      latestChapter: { title: 'Chapter 210', url: 'https://komiku.org/kaguya-sama-chapter-210/', num: 210, date: daysAgo(96) },
      nextChapter: null,
      createdAt: now,
      updatedAt: now
    }
  ]
};

fs.writeFileSync(path.join(target, 'db.json'), JSON.stringify(demo, null, 2));
console.log('Data contoh dibuat di', path.join(target, 'db.json'), '—', demo.items.length, 'item');
