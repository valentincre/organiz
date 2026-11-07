import {
  ArrowLeft,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleX,
  ClipboardCheck,
  Clock,
  CloudOff,
  Copy,
  Download,
  Ellipsis,
  GripVertical,
  Info,
  Link,
  List,
  ListFilter,
  LoaderCircle,
  Lock,
  Moon,
  Pencil,
  Plus,
  QrCode,
  Repeat,
  Search,
  Share2,
  Sun,
  Tag,
  Trash2,
  TriangleAlert,
  User,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cx } from './styles'

// Every icon of the app comes from Lucide, through these wrappers, so they
// share one size, stroke and color (the text's): 20 px, or 16 px with
// `small` for rows, pills and small buttons. They are decorative: the button
// or text next to them carries the meaning.

interface IconProps {
  small?: boolean
  className?: string
}

function Icon({ icon: Glyph, small = false, className }: IconProps & { icon: LucideIcon }) {
  return (
    <Glyph
      size={small ? 16 : 20}
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
      className={cx(small ? 'size-4' : 'size-5', 'shrink-0', className)}
    />
  )
}

export function LinkIcon(props: IconProps) {
  return <Icon icon={Link} {...props} />
}

export function ShareIcon(props: IconProps) {
  return <Icon icon={Share2} {...props} />
}

export function CopyIcon(props: IconProps) {
  return <Icon icon={Copy} {...props} />
}

export function QrIcon(props: IconProps) {
  return <Icon icon={QrCode} {...props} />
}

/** Closing something for good, such as a reply link. */
export function CloseCircleIcon(props: IconProps) {
  return <Icon icon={CircleX} {...props} />
}

export function DownloadIcon(props: IconProps) {
  return <Icon icon={Download} {...props} />
}

export function CheckIcon(props: IconProps) {
  return <Icon icon={Check} {...props} />
}

export function CalendarIcon(props: IconProps) {
  return <Icon icon={Calendar} {...props} />
}

export function ListIcon(props: IconProps) {
  return <Icon icon={List} {...props} />
}

export function PersonIcon(props: IconProps) {
  return <Icon icon={User} {...props} />
}

export function TagIcon(props: IconProps) {
  return <Icon icon={Tag} {...props} />
}

export function WarningIcon(props: IconProps) {
  return <Icon icon={TriangleAlert} {...props} />
}

export function InfoIcon(props: IconProps) {
  return <Icon icon={Info} {...props} />
}

export function LockIcon(props: IconProps) {
  return <Icon icon={Lock} {...props} />
}

export function PencilIcon(props: IconProps) {
  return <Icon icon={Pencil} {...props} />
}

/** The roll call. */
export function CallIcon(props: IconProps) {
  return <Icon icon={ClipboardCheck} {...props} />
}

export function ClockIcon(props: IconProps) {
  return <Icon icon={Clock} {...props} />
}

export function RepeatIcon(props: IconProps) {
  return <Icon icon={Repeat} {...props} />
}

export function FilterIcon(props: IconProps) {
  return <Icon icon={ListFilter} {...props} />
}

export function SearchIcon(props: IconProps) {
  return <Icon icon={Search} {...props} />
}

export function SortIcon(props: IconProps) {
  return <Icon icon={ArrowUpDown} {...props} />
}

export function MoreIcon(props: IconProps) {
  return <Icon icon={Ellipsis} {...props} />
}

export function TrashIcon(props: IconProps) {
  return <Icon icon={Trash2} {...props} />
}

export function CloseIcon(props: IconProps) {
  return <Icon icon={X} {...props} />
}

export function BackIcon(props: IconProps) {
  return <Icon icon={ArrowLeft} {...props} />
}

export function PlusIcon(props: IconProps) {
  return <Icon icon={Plus} {...props} />
}

/** The ⋮⋮ handle of sortable lists. */
export function GripIcon(props: IconProps) {
  return <Icon icon={GripVertical} {...props} />
}

export function SunIcon(props: IconProps) {
  return <Icon icon={Sun} {...props} />
}

export function MoonIcon(props: IconProps) {
  return <Icon icon={Moon} {...props} />
}

export function CloudOffIcon(props: IconProps) {
  return <Icon icon={CloudOff} {...props} />
}

export function SpinnerIcon({ className, ...props }: IconProps) {
  return <Icon icon={LoaderCircle} className={cx('animate-spin', className)} {...props} />
}

const chevrons = { left: ChevronLeft, right: ChevronRight, down: ChevronDown } as const

export function ChevronIcon({ direction, ...props }: IconProps & { direction: keyof typeof chevrons }) {
  return <Icon icon={chevrons[direction]} {...props} />
}
