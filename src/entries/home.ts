import { createPage } from '@/app/createPage'
import HomePage from '@/pages/HomePage.vue'
import Lightbox from '@/components/media/Lightbox.vue'

createPage(HomePage, { afterMain: Lightbox })
