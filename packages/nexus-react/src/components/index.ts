/** 标准组件 renderMap：Basic Catalog 当前已实现的 17 个组件。 */
import type { RenderMap } from '../types';
import { AudioPlayer } from './AudioPlayer';
import { Button } from './Button';
import { CheckBox } from './CheckBox';
import { ChoicePicker } from './ChoicePicker';
import { DateTimeInput } from './DateTimeInput';
import { Card } from './Card';
import { Column } from './Column';
import { Divider } from './Divider';
import { Icon } from './Icon';
import { Image } from './Image';
import { List } from './List';
import { Row } from './Row';
import { Slider } from './Slider';
import { Tabs } from './Tabs';
import { Text } from './Text';
import { TextField } from './TextField';
import { Video } from './Video';

export const standardRenderMap: RenderMap = {
  Text,
  TextField,
  CheckBox,
  ChoicePicker,
  DateTimeInput,
  Slider,
  Button,
  Column,
  Row,
  List,
  Tabs,
  Image,
  Card,
  Icon,
  Divider,
  Video,
  AudioPlayer,
};
export {
  AudioPlayer,
  Button,
  Card,
  CheckBox,
  ChoicePicker,
  DateTimeInput,
  Slider,
  Column,
  Divider,
  Icon,
  Image,
  List,
  Row,
  Tabs,
  Text,
  TextField,
  Video,
};
