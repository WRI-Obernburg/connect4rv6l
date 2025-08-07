import type { Meta, StoryObj } from '@storybook/react-vite';

import { fn } from 'storybook/test';
import GameField from '../components/GameField';


// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: 'Example/GameField',
  component: GameField,
  parameters: {
    // Optional parameter to center the component in the Canvas. More info: https://storybook.js.org/docs/configure/story-layout
    layout: 'centered',
  },
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ['autodocs'],
  // More on argTypes: https://storybook.js.org/docs/api/argtypes
  argTypes: {
    
  },
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: {  },
} satisfies Meta<typeof GameField>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    board: [[],[],[],[],[],[],[]],
    interactive: false,
    xl: true
  },
};

export const PlayerWinnerVertical: Story = {
  args: {
    board: [[1,1,1,1],[],[],[],[],[],[]],
    interactive: false,
    xl: true
  },
};

export const RobotWinnerVertical: Story = {
  args: {
    board: [[2,2,2,2],[],[],[],[],[],[]],
    interactive: false,
    xl: true
  },
};

export const PlayerWinnerHorizontal: Story = {
  args: {
    board: [[1],[1],[1],[1],[],[],[]],
    interactive: false,
    xl: true
  },
};


export const RobotWinnerHorizontal: Story = {
  args: {
    board: [[2],[2],[2],[2],[],[],[]],
    interactive: false,
    xl: true
  },
};



export const PlayerWinnerDiagonal: Story = {
  args: {
    board: [[1],[2,1],[2,2,1],[2,2,2,1],[],[],[]],
    interactive: false,
    xl: true
  },
};

export const RobotWinnerDiagonal: Story = {
  args: {
    board: [[2],[1,2],[1,1,2],[1,1,1,2],[],[],[]],
    interactive: false,
    xl: true
  },
};


export const Interactive: Story = {
  args: {
    board: [[2],[1,2],[1,1,2],[1,1,1,2],[],[],[]],
    interactive: true,
    xl: false,
    isPlayerTurn: true,
    onColumnClick(columnIndex) {
      
    },
  },
};

