// Database connection setup

import { DataSource } from 'typeorm';
import { User, VideoJob, migrations } from '@frameforgetech/shared-contracts';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'frameforge',
  entities: [User, VideoJob],
  migrations: migrations,
  synchronize: false, // Use migrations instead
  logging: process.env.NODE_ENV === 'development',
  poolSize: 50, // Connection pooling as per requirements
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false, // Enable SSL for RDS
});

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    console.log('Database connection established');
    
    // Run pending migrations
    await AppDataSource.runMigrations();
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
}
