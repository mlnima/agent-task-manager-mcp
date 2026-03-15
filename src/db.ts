import mongoose from 'mongoose'
import 'dotenv/config'

let isConnected = false

const connectDB = async (): Promise<void> => {
  if (isConnected) return

  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set in environment variables')

  await mongoose.connect(uri)
  isConnected = true
  console.error('[DB] Connected to MongoDB')
}

export default connectDB
