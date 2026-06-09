import { connect, type Channel } from 'amqplib';

type Conn = Awaited<ReturnType<typeof connect>>;

export interface MqHandle {
  connection: Conn;
  channel: Channel;
}

export async function connectMq(url = process.env['AMQP_URL']): Promise<MqHandle> {
  if (!url) throw new Error('Variável de ambiente obrigatória ausente: AMQP_URL');
  const connection = await connect(url);
  const channel = await connection.createChannel();
  return { connection, channel };
}
