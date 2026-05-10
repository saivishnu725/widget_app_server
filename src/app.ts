import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/authRoutes';
import widgetRoutes from './routes/widgetRoutes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/api/widgets', widgetRoutes);

app.get('/', (req, res) => {
  res.send('Widget App Server API');
});

export default app;
