/** 标准组件 renderMap：Text / TextField / CheckBox / ChoicePicker / Slider / DateTimeInput / Button / Column / Row / List / Tabs / Image / Card / Icon / Divider。 */
import type { RenderMap } from '../types';
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
};
export {
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
};
