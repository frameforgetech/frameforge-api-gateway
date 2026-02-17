// Database connection setup

import { DataSource } from 'typeorm';
import { User } from '@frameforge/shared-contracts';
import { VideoJob } from '@frameforge/shared-contracts';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'frameforge',
  entities: [User, VideoJob],
  synchronize: false, // Use migrations instead
  logging: process.env.NODE_ENV === 'development',
  poolSize: 50, // Connection pooling as per requirements
});

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    console.log('Database connection established');
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}
