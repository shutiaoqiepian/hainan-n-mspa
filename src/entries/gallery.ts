import { createPage } from '@/app/createPage'
import GalleryPage from '@/pages/GalleryPage.vue'
import Lightbox from '@/components/media/Lightbox.vue'
import { COPYRIGHT_GALLERY } from '@/data/site'

createPage(GalleryPage, { copyright: COPYRIGHT_GALLERY, afterMain: Lightbox })
