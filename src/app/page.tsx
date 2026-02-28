import { redirect } from 'next/navigation'

// Root → redirect to refunds dashboard
export default function Home() {
  redirect('/refunds')
}
