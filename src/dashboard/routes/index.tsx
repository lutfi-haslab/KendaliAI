import { createFileRoute } from '@tanstack/react-router'
import { IndexPage } from '../pages/Index'

export const Route = createFileRoute('/')({
  component: IndexPage,
})
