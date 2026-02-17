// RabbitMQ connection setup

import * as amqplib from 'amqplib';

let connection: any = null;
let channel: any = null;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const VIDEO_PROCESSING_QUEUE = 'video.processing';

export async function initializeRabbitMQ(): Promise<void> {
  try {
    connection = await amqplib.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    
    // Assert queue exists (create if it doesn't)
    await channel.assertQueue(VIDEO_PROCESSING_QUEUE, {
      durable: true, // Persist messages to disk
    });
    
    console.log('RabbitMQ connection established');
  } catch (error) {
    console.error('Error connecting to RabbitMQ:', error);
    throw error;
  }
}

export function getChannel(): any {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  return channel;
}

export async function publishToQueue(queueName: string, message: any): Promise<void> {
  const ch = getChannel();
  const messageBuffer = Buffer.from(JSON.stringify(message));
  
  ch.sendToQueue(queueName, messageBuffer, {
    persistent: true, // Persist message to disk
  });
}

export async function closeRabbitMQ(): Promise<void> {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    console.log('RabbitMQ connection closed');
  } catch (error) {
    console.error('Error closing RabbitMQ connection:', error);
  }
}
