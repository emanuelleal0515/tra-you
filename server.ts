import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { YoutubeTranscript } from 'youtube-transcript';
import cors from 'cors';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API endpoint for transcript extraction
  app.get('/api/transcript', async (req, res) => {
    const videoUrl = req.query.url as string;
    if (!videoUrl) {
      return res.status(400).json({ error: 'URL is required' });
    }

    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoUrl);
      res.json(transcript);
    } catch (error: any) {
      console.error('Transcript error:', error);
      res.status(500).json({ 
        error: 'Could not extract transcript. Ensure the video has captions enabled.',
        message: error.message 
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
