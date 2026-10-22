import { createPage } from '@/app/createPage'
import ForecastPage from '@/pages/ForecastPage.vue'
import FeedbackModal from '@/components/forecast/FeedbackModal.vue'

createPage(ForecastPage, { overlay: FeedbackModal })
